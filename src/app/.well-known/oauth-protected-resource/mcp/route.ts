import {
  metadataCorsPreflight,
  metadataJson,
  protectedResourceMetadata,
} from '@/lib/mcp/authkit-oauth'

/**
 * OAuth 2.0 Protected Resource Metadata for the MCP endpoint (RFC 9728).
 *
 * An MCP client that hits /api/mcp without a token gets a 401 whose
 * `WWW-Authenticate` points here; this document names the resource, the AuthKit
 * authorization server to get a token from, and how to present it. No scopes are
 * advertised: AuthKit issues user-scoped access tokens and this resource makes
 * no per-scope distinctions, so listing any would be a claim we don't enforce.
 *
 * Public + CORS-enabled so any MCP client can discover it. The middleware
 * (src/proxy.ts) exempts /.well-known/* so this isn't gated behind sign-in.
 */
export function GET(request: Request): Response {
  return metadataJson(protectedResourceMetadata(request))
}

export function OPTIONS(): Response {
  return metadataCorsPreflight()
}
