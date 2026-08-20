import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { verifyAccessToken } from '@/lib/mcp/authkit-oauth'
import { registerTools } from '@/lib/mcp/tools'

/**
 * MCP server for the workout tracker, exposed as an in-app Streamable HTTP
 * endpoint at /api/mcp (the [transport] segment resolves to "mcp").
 *
 * Authenticated with WorkOS AuthKit OAuth via `withMcpAuth`: `verifyAccessToken`
 * verifies the bearer JWT against AuthKit's JWKS and stashes the WorkOS user id
 * in `AuthInfo.extra.userId`, which the tools read through `resolveUserId`. Auth
 * is REQUIRED only in production (no token → 401 with a `WWW-Authenticate`
 * pointing at the protected-resource metadata); locally it's optional so
 * `MCP_DEV_USER_ID` keeps the endpoint usable without signing in. The
 * `.well-known` discovery routes and the middleware exemption (src/proxy.ts)
 * make the OAuth handshake work.
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

const handler = withMcpAuth(base, verifyAccessToken, {
  // Require auth in prod; keep dev usable via MCP_DEV_USER_ID.
  required: process.env.NODE_ENV === 'production',
  resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
})

export { handler as GET, handler as POST }
