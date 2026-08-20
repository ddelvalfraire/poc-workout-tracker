import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET, OPTIONS } from './route'

const ISSUER = 'https://workout-tracker-12345.authkit.app'
const RESOURCE = 'https://tracker.example.com/api/mcp'
const METADATA_URL = 'https://tracker.example.com/.well-known/oauth-protected-resource/mcp'

beforeEach(() => {
  vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', ISSUER)
  vi.stubEnv('MCP_RESOURCE_URL', RESOURCE)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /.well-known/oauth-protected-resource/mcp', () => {
  it('returns the RFC 9728 document naming AuthKit as the authorization server', async () => {
    // Arrange
    const request = new Request(METADATA_URL)

    // Act
    const response = GET(request)

    // Assert
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
    })
  })

  it('is readable cross-origin so any MCP client can discover it', () => {
    // Act
    const response = GET(new Request(METADATA_URL))

    // Assert
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('OPTIONS /.well-known/oauth-protected-resource/mcp', () => {
  it('answers the CORS preflight with 204', () => {
    // Act
    const response = OPTIONS()

    // Assert
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET')
  })
})
