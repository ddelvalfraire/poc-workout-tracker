import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

/**
 * OAuth glue between the MCP endpoint (/api/mcp) and WorkOS AuthKit.
 *
 * AuthKit is itself a spec-compatible OAuth 2.1 authorization server, so unlike
 * the Clerk setup this app carries no authorization-server code and needs no
 * pre-registered client: MCP clients register themselves through AuthKit's
 * Client ID Metadata Document (or Dynamic Client Registration for older ones).
 * All this module does is the RESOURCE-SERVER half — verify the access token
 * AuthKit issued, and publish the two discovery documents that point clients at
 * AuthKit in the first place.
 *
 * Lives in src/lib/mcp (not inside the route files) because all three routes —
 * the transport and both `.well-known` documents — must agree on exactly one
 * issuer and one resource identifier; a mismatch silently breaks the handshake.
 */

/** Issuer + JWKS host, e.g. `https://poc-workout-tracker-12345.authkit.app`. */
const AUTHKIT_DOMAIN_ENV = 'WORKOS_AUTHKIT_DOMAIN'

/** The MCP endpoint's own path, appended when deriving the resource identifier. */
const MCP_PATH = '/api/mcp'

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * The AuthKit issuer. Throws rather than defaulting: a wrong issuer makes
 * `jwtVerify` reject every token, and a loud failure naming the env var beats
 * debugging a mystery 401.
 */
export function getAuthkitIssuer(): string {
  const domain = process.env[AUTHKIT_DOMAIN_ENV]?.trim()
  if (!domain) {
    throw new Error(`${AUTHKIT_DOMAIN_ENV} is not configured (e.g. https://your-app.authkit.app)`)
  }
  return stripTrailingSlash(domain)
}

/** AuthKit publishes its signing keys at `<issuer>/oauth2/jwks`. */
export function getJwksUrl(): URL {
  return new URL(`${getAuthkitIssuer()}/oauth2/jwks`)
}

/**
 * The resource indicator this server is known by — the `resource` an MCP client
 * asks for and therefore the `aud` AuthKit stamps on the token. It must equal
 * the Resource Indicator registered in the WorkOS dashboard.
 *
 * Defaults to the request's own origin + /api/mcp so local dev and preview
 * deployments work unconfigured; MCP_RESOURCE_URL pins it for production, where
 * a proxy-rewritten Host would otherwise produce an audience that never matches.
 */
export function getResourceUrl(request: Request): string {
  const configured = process.env.MCP_RESOURCE_URL?.trim()
  if (configured) return stripTrailingSlash(configured)
  return `${new URL(request.url).origin}${MCP_PATH}`
}

/**
 * jose caches keys and rate-limits refetches per JWKS instance, so the set is
 * built once per issuer instead of per request. Keyed by URL so a changed env
 * var in tests/dev doesn't hand back a stale key set.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(url: URL): ReturnType<typeof createRemoteJWKSet> {
  const key = url.toString()
  const cached = jwksCache.get(key)
  if (cached) return cached
  const jwks = createRemoteJWKSet(url)
  jwksCache.set(key, jwks)
  return jwks
}

/**
 * Verifies an AuthKit access token and shapes it into the MCP SDK's `AuthInfo`.
 *
 * The WorkOS user id (`sub`) goes in `extra.userId`, which is the contract
 * `resolveUserId` (src/lib/mcp/resolve-user.ts) reads to decide whose data a
 * tool call touches — so this is the authorization boundary for the whole MCP
 * surface. There is no external-id mapping: WorkOS ids ARE the app's user ids.
 *
 * Returns undefined for a missing, expired, forged, wrong-issuer or
 * wrong-audience token; `withMcpAuth` turns that into a spec 401 whose
 * `WWW-Authenticate` points at the protected-resource metadata (in prod).
 */
export async function verifyAccessToken(
  request: Request,
  token?: string,
): Promise<AuthInfo | undefined> {
  if (!token) return undefined

  try {
    const { payload } = await jwtVerify(token, getJwks(getJwksUrl()), {
      issuer: getAuthkitIssuer(),
      audience: getResourceUrl(request),
    })

    const userId = typeof payload.sub === 'string' ? payload.sub.trim() : ''
    if (!userId) return undefined

    return {
      token,
      // AuthKit puts the OAuth client on `client_id`; `resolveActor` only ever
      // compares it against the coach bridge's sentinel, so unknown is fine.
      clientId: typeof payload.client_id === 'string' ? payload.client_id : '',
      scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
      expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
      extra: { userId },
    }
  } catch (error) {
    // In dev (`required: false`) a failed verification falls through to
    // MCP_DEV_USER_ID; surface it so a real token problem isn't silently
    // masked by the dev fallback.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[mcp] bearer token present but AuthKit verification failed:', error)
    }
    return undefined
  }
}

/** CORS for the discovery documents: any MCP client, on any origin, may read them. */
export const METADATA_CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-protocol-version',
}

/** Preflight handler shared by both `.well-known` routes. */
export function metadataCorsPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...METADATA_CORS_HEADERS } })
}

/** JSON + the same CORS headers, so a browser-based client can read the body. */
export function metadataJson(body: unknown): Response {
  return Response.json(body, { headers: { ...METADATA_CORS_HEADERS } })
}

/** OAuth 2.0 Protected Resource Metadata (RFC 9728) for /api/mcp. */
export function protectedResourceMetadata(request: Request): Record<string, unknown> {
  return {
    resource: getResourceUrl(request),
    authorization_servers: [getAuthkitIssuer()],
    bearer_methods_supported: ['header'],
  }
}
