import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET, OPTIONS } from './route'

const ISSUER = 'https://workout-tracker-12345.authkit.app'

const AUTHKIT_METADATA = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth2/authorize`,
  token_endpoint: `${ISSUER}/oauth2/token`,
  registration_endpoint: `${ISSUER}/oauth2/register`,
}

beforeEach(() => {
  vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', ISSUER)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('GET /.well-known/oauth-authorization-server', () => {
  it("mirrors AuthKit's metadata verbatim, with CORS headers", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue(Response.json(AUTHKIT_METADATA))
    vi.stubGlobal('fetch', fetchMock)

    // Act
    const response = await GET()

    // Assert
    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/.well-known/oauth-authorization-server`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    await expect(response.json()).resolves.toEqual(AUTHKIT_METADATA)
  })

  it('fails with 502 rather than passing off an empty document as valid metadata', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })))

    // Act
    const response = await GET()

    // Assert
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'authkit_metadata_unavailable' })
  })
})

describe('OPTIONS /.well-known/oauth-authorization-server', () => {
  it('answers the CORS preflight with 204', () => {
    // Act
    const response = OPTIONS()

    // Assert
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
