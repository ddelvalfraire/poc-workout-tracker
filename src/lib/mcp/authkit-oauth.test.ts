import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// jose is mocked wholesale: these tests pin OUR contract (which claims map onto
// AuthInfo, what a rejection turns into), not jose's signature verification.
const jwtVerify = vi.hoisted(() => vi.fn())
// The module memoizes the key set per JWKS URL, so this factory may legitimately
// run only once across the suite — assert on what jwtVerify receives instead.
const createRemoteJWKSet = vi.hoisted(() => vi.fn(() => 'jwks-stub'))
vi.mock('jose', () => ({ jwtVerify, createRemoteJWKSet }))

import {
  METADATA_CORS_HEADERS,
  getAuthkitIssuer,
  getJwksUrl,
  getResourceUrl,
  metadataCorsPreflight,
  protectedResourceMetadata,
  verifyAccessToken,
} from './authkit-oauth'

const ISSUER = 'https://workout-tracker-12345.authkit.app'
const RESOURCE = 'https://tracker.example.com/api/mcp'

function mcpRequest(url = RESOURCE): Request {
  return new Request(url, { method: 'POST' })
}

beforeEach(() => {
  vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', ISSUER)
  vi.stubEnv('MCP_RESOURCE_URL', RESOURCE)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('getAuthkitIssuer', () => {
  it('returns the configured domain without a trailing slash', () => {
    // Arrange
    vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', `${ISSUER}/`)

    // Act / Assert
    expect(getAuthkitIssuer()).toBe(ISSUER)
  })

  it('throws a message naming the env var when it is unset', () => {
    // Arrange
    vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', '')

    // Act / Assert
    expect(() => getAuthkitIssuer()).toThrow(/WORKOS_AUTHKIT_DOMAIN/)
  })
})

describe('getJwksUrl', () => {
  it('points at AuthKit oauth2/jwks', () => {
    expect(getJwksUrl().toString()).toBe(`${ISSUER}/oauth2/jwks`)
  })
})

describe('getResourceUrl', () => {
  it('prefers the configured resource indicator', () => {
    expect(getResourceUrl(mcpRequest('https://some-preview.vercel.app/api/mcp'))).toBe(RESOURCE)
  })

  it("falls back to the request's own origin + /api/mcp", () => {
    // Arrange
    vi.stubEnv('MCP_RESOURCE_URL', '')

    // Act / Assert
    expect(getResourceUrl(mcpRequest('http://localhost:3000/api/mcp'))).toBe(
      'http://localhost:3000/api/mcp',
    )
  })
})

describe('verifyAccessToken', () => {
  it('maps a valid token to AuthInfo with the WorkOS user id in extra.userId', async () => {
    // Arrange
    jwtVerify.mockResolvedValue({
      payload: {
        sub: 'user_01JABCDEF',
        client_id: 'client_01XYZ',
        scope: 'openid profile',
        exp: 1_800_000_000,
      },
    })

    // Act
    const authInfo = await verifyAccessToken(mcpRequest(), 'good-token')

    // Assert — extra.userId is the contract resolveUserId reads.
    expect(authInfo?.extra?.userId).toBe('user_01JABCDEF')
    expect(authInfo?.clientId).toBe('client_01XYZ')
    expect(authInfo?.scopes).toEqual(['openid', 'profile'])
    expect(authInfo?.expiresAt).toBe(1_800_000_000)
  })

  it("verifies against the AuthKit issuer, its JWKS, and the resource as audience", async () => {
    // Arrange
    jwtVerify.mockResolvedValue({ payload: { sub: 'user_01JABCDEF' } })

    // Act
    await verifyAccessToken(mcpRequest(), 'good-token')

    // Assert — 'jwks-stub' is what the mocked createRemoteJWKSet returns, so
    // this also proves the key set (not a literal) reached jwtVerify.
    expect(jwtVerify).toHaveBeenCalledWith('good-token', 'jwks-stub', {
      issuer: ISSUER,
      audience: RESOURCE,
    })
  })

  it('returns undefined when no token is presented', async () => {
    // Act
    const authInfo = await verifyAccessToken(mcpRequest(), undefined)

    // Assert — withMcpAuth turns this into a 401 in production.
    expect(authInfo).toBeUndefined()
    expect(jwtVerify).not.toHaveBeenCalled()
  })

  it('returns undefined and warns when verification fails (expired or forged)', async () => {
    // Arrange
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    jwtVerify.mockRejectedValue(new Error('"exp" claim timestamp check failed'))

    // Act
    const authInfo = await verifyAccessToken(mcpRequest(), 'expired-token')

    // Assert — the warn keeps a real token problem from hiding behind the
    // MCP_DEV_USER_ID fallback.
    expect(authInfo).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns undefined when the token carries no subject', async () => {
    // Arrange — a token with no `sub` would otherwise yield an empty userId.
    jwtVerify.mockResolvedValue({ payload: { sub: '   ' } })

    // Act / Assert
    await expect(verifyAccessToken(mcpRequest(), 'subjectless')).resolves.toBeUndefined()
  })
})

describe('protectedResourceMetadata', () => {
  it('declares the resource, its authorization server, and bearer methods', () => {
    // Act
    const metadata = protectedResourceMetadata(mcpRequest())

    // Assert
    expect(metadata).toEqual({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
    })
  })
})

describe('metadataCorsPreflight', () => {
  it('answers 204 with permissive CORS headers', () => {
    // Act
    const response = metadataCorsPreflight()

    // Assert
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      METADATA_CORS_HEADERS['Access-Control-Allow-Methods'],
    )
  })
})
