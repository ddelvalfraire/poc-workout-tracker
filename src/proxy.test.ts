import { describe, it, expect, vi } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * Mock AuthKit so importing `./proxy` exercises the routing decisions without
 * a WorkOS session. `authkit()` returns the session/headers/authorizationUrl
 * triple the real one does; `handleAuthkitProxy` collapses to a tagged value
 * (or a redirect Response) so assertions can read the branch that was taken.
 */
const AUTHORIZATION_URL = 'https://auth.example.com/authorize?client_id=client_test'

const mockAuthkit = vi.fn()

vi.mock('@workos-inc/authkit-nextjs', () => ({
  authkit: (...args: unknown[]) => mockAuthkit(...args),
  handleAuthkitProxy: (_req: unknown, _headers: unknown, options?: { redirect?: string }) =>
    options?.redirect
      ? NextResponse.redirect(options.redirect, 307)
      : ({ __passthrough: true } as unknown as NextResponse),
}))

import proxy from './proxy'
import type { NextRequest } from 'next/server'

const req = (url: string) => ({ url }) as unknown as NextRequest

/** Sets the AuthKit session for the next request. */
function setSession(userId: string | null) {
  mockAuthkit.mockResolvedValue({
    session: { user: userId === null ? null : { id: userId } },
    headers: new Headers(),
    authorizationUrl: AUTHORIZATION_URL,
  })
}

describe('proxy middleware', () => {
  it('redirects a signed-out user on a protected route to AuthKit', async () => {
    // Arrange
    setSession(null)

    // Act
    const result = (await proxy(req('http://localhost:3000/'))) as Response

    // Assert — AuthKit's authorizationUrl carries the return path
    expect(result.status).toBe(307)
    expect(result.headers.get('location')).toBe(AUTHORIZATION_URL)
  })

  it('does not redirect a signed-in user on a protected route', async () => {
    // Arrange
    setSession('user_01HWORKOS')

    // Act
    const result = await proxy(req('http://localhost:3000/workout/new'))

    // Assert
    expect(result).toEqual({ __passthrough: true })
  })

  it.each([
    '/sign-in',
    '/sign-up',
    // AuthKit's OAuth callback: reached mid-handshake, before a session exists.
    '/callback',
    '/api/mcp',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    // Public program share page — self-gating (resolveShare 404s dead tokens);
    // a redirect-to-sign-in here would kill the acquisition surface.
    '/p/tok_abcdefghijklmnopqrstuvwxyz012345',
    // Public workout share page — same self-gating rationale as /p above.
    '/w/tok_abcdefghijklmnopqrstuvwxyz012345',
    // PostHog ingest proxy — anonymous visitors' events are the acquisition
    // funnel; a sign-in redirect here would blind it.
    '/_i/e',
    // Public legal documents — MHMDA wants the health policy reachable
    // without an account, and store review fetches them unauthenticated.
    '/terms',
    '/privacy',
    '/health-privacy',
  ])('leaves the public route %s alone even when signed out', async (path) => {
    // Arrange
    setSession(null)

    // Act
    const result = await proxy(req(`http://localhost:3000${path}`))

    // Assert — public routes never get gated
    expect(result).toEqual({ __passthrough: true })
  })

  // next.config.ts disables Next's global trailing-slash 308 (PostHog's ingest
  // paths need their slashes); the middleware re-provides it for everything
  // else. These pin both halves of that contract.
  it('308-redirects a trailing-slash path to its slashless form', async () => {
    // Arrange
    setSession(null)

    // Act
    const result = (await proxy(
      req('http://localhost:3000/p/tok_abcdefghijklmnopqrstuvwxyz012345/'),
    )) as Response

    // Assert — same 308 Next itself used to issue
    expect(result.status).toBe(308)
    expect(result.headers.get('location')).toBe(
      'http://localhost:3000/p/tok_abcdefghijklmnopqrstuvwxyz012345',
    )
  })

  it('leaves trailing slashes on /_i paths intact for the PostHog rewrite', async () => {
    // Arrange
    setSession(null)

    // Act — /e/ is PostHog's event-capture endpoint shape
    const result = await proxy(req('http://localhost:3000/_i/e/'))

    // Assert — no redirect, no auth gate; the rewrite must see the slash
    expect(result).toEqual({ __passthrough: true })
  })
})
