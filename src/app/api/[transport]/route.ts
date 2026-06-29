import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { verifyClerkToken } from '@clerk/mcp-tools/next'
import { auth } from '@clerk/nextjs/server'
import { registerTools } from '@/lib/mcp/tools'

/**
 * MCP server for the workout tracker, exposed as an in-app Streamable HTTP
 * endpoint at /api/mcp (the [transport] segment resolves to "mcp").
 *
 * Authenticated with Clerk OAuth via `withMcpAuth`: `verifyToken` exchanges the
 * bearer token for a Clerk user and stashes the id in `AuthInfo.extra.userId`,
 * which the tools read through `resolveUserId`. Auth is REQUIRED only in
 * production (no token → 401 with a `WWW-Authenticate` pointing at the
 * protected-resource metadata); locally it's optional so `MCP_DEV_USER_ID` keeps
 * the endpoint usable without signing in. The `.well-known` discovery routes and
 * the Clerk middleware exemption (src/proxy.ts) make the OAuth handshake work.
 *
 * Tool registration lives in @/lib/mcp/tools (registerTools) so it is unit-testable
 * without the Streamable HTTP handshake.
 */
const base = createMcpHandler(
  registerTools,
  {
    // Identifies this server to connecting MCP clients (shown in their UI).
    serverInfo: { name: 'workout-tracker', version: '0.1.0' },
  },
  {
    // basePath must match where the [transport] segment lives so the client URL
    // is exactly /api/mcp. Streamable HTTP only — no redisUrl (Redis is SSE-only).
    basePath: '/api',
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV !== 'production',
  },
)

/**
 * Exchanges an OAuth bearer token for a Clerk user. `auth({ acceptsToken:
 * 'oauth_token' })` validates the token as an MCP OAuth access token from the
 * request's Authorization header; `verifyClerkToken` cross-checks that against
 * the same raw `token` and shapes it into the SDK `AuthInfo` with the user id in
 * `extra.userId`. No token → undefined, which `withMcpAuth` turns into a spec 401
 * (in prod). An expired/forged token also yields undefined.
 */
const verifyToken = async (_req: Request, token?: string) => {
  if (!token) return undefined
  const authInfo = verifyClerkToken(await auth({ acceptsToken: 'oauth_token' }), token)
  // In dev (required:false) a failed verification falls through to MCP_DEV_USER_ID;
  // surface it so a real token problem isn't silently masked by the dev fallback.
  if (!authInfo && process.env.NODE_ENV !== 'production') {
    console.warn('[mcp] bearer token present but Clerk verification failed; using dev fallback')
  }
  return authInfo
}

const handler = withMcpAuth(base, verifyToken, {
  // Require auth in prod; keep dev usable via MCP_DEV_USER_ID.
  required: process.env.NODE_ENV === 'production',
  resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
})

export { handler as GET, handler as POST }
