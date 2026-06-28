import {
  protectedResourceHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from '@clerk/mcp-tools/next'

/**
 * OAuth 2.0 Protected Resource Metadata for the MCP endpoint (RFC 9728).
 *
 * An MCP client that hits /api/mcp without a token gets a 401 whose
 * `WWW-Authenticate` points here; this document tells the client which Clerk
 * authorization server to use and which scopes the resource supports. The
 * advertised scopes must match the Clerk OAuth app's granted scopes.
 *
 * Public + CORS-enabled so any MCP client can discover it. The Clerk middleware
 * (src/proxy.ts) exempts /.well-known/* so this isn't gated behind sign-in.
 */
const handler = protectedResourceHandlerClerk({
  scopes_supported: ['openid', 'profile', 'email'],
})

const corsHandler = metadataCorsOptionsRequestHandler()

export { handler as GET, corsHandler as OPTIONS }
