import {
  METADATA_CORS_HEADERS,
  getAuthkitIssuer,
  metadataCorsPreflight,
  metadataJson,
} from '@/lib/mcp/authkit-oauth'

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414), proxied from AuthKit.
 *
 * LEGACY CLIENTS ONLY. A current MCP client reads the protected-resource
 * document, sees AuthKit named as the authorization server, and fetches this
 * metadata from AuthKit directly; older clients instead look for it on the
 * resource server's own origin. Mirroring AuthKit's copy verbatim (rather than
 * composing our own) means the authorize/token/registration endpoints can never
 * drift from what actually issues the tokens.
 *
 * Public + CORS-enabled, like the protected-resource document.
 */
export async function GET(): Promise<Response> {
  const upstream = await fetch(`${getAuthkitIssuer()}/.well-known/oauth-authorization-server`)
  if (!upstream.ok) {
    // 502, not a 200 with an error body: a client must not mistake our failure
    // to reach AuthKit for a valid (but endpoint-less) metadata document.
    return new Response(JSON.stringify({ error: 'authkit_metadata_unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...METADATA_CORS_HEADERS },
    })
  }
  return metadataJson(await upstream.json())
}

export function OPTIONS(): Response {
  return metadataCorsPreflight()
}
