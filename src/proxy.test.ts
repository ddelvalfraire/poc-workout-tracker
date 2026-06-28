import { describe, it, expect, vi, type Mock } from 'vitest'

/**
 * Mock Clerk so importing `./proxy` yields the raw route-guard callback rather
 * than a wired-up middleware. `clerkMiddleware(cb)` returns `cb` here, and
 * `createRouteMatcher(patterns)` returns a small path-prefix matcher that mirrors
 * the real `'/x(.*)'` semantics closely enough for routing assertions.
 */
vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: (cb: unknown) => cb,
  createRouteMatcher: (patterns: string[]) => (req: { url: string }) => {
    const path = new URL(req.url).pathname
    return patterns.some((p) => new RegExp('^' + p.replace(/\(\.\*\)/g, '.*') + '$').test(path))
  },
}))

import proxyDefault from './proxy'

type AuthState = {
  authFn: ((...args: unknown[]) => Promise<{ userId: string | null; redirectToSignIn: Mock }>) & {
    protect: Mock
  }
  redirectToSignIn: Mock
  protect: Mock
}

// At runtime the mocked `clerkMiddleware` returns the raw callback, but its static
// type is `NextMiddleware`; cast to the callback shape so the tests can invoke it.
const handler = proxyDefault as unknown as (
  auth: AuthState['authFn'],
  req: Request,
) => Promise<unknown>

/** A fake Clerk middleware `auth` — callable (returns the session) and with `.protect`. */
function makeAuth(userId: string | null): AuthState {
  const redirectToSignIn = vi.fn(() => ({ __redirect: true }))
  const protect = vi.fn()
  const authFn = Object.assign(vi.fn(async () => ({ userId, redirectToSignIn })), { protect })
  return { authFn, redirectToSignIn, protect }
}

const req = (url: string) => ({ url }) as unknown as Request

describe('proxy middleware', () => {
  it('redirects a signed-out user on a protected route to sign-in', async () => {
    // Arrange
    const { authFn, redirectToSignIn } = makeAuth(null)

    // Act
    const result = await handler(authFn, req('http://localhost:3000/'))

    // Assert — explicit redirect, not Clerk's context-detecting protect()
    expect(redirectToSignIn).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ __redirect: true })
  })

  it('does not redirect a signed-in user on a protected route', async () => {
    // Arrange
    const { authFn, redirectToSignIn } = makeAuth('user_123')

    // Act
    const result = await handler(authFn, req('http://localhost:3000/workout/new'))

    // Assert
    expect(redirectToSignIn).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  it.each(['/sign-in', '/sign-up', '/api/mcp'])(
    'leaves the public route %s alone even when signed out',
    async (path) => {
      // Arrange
      const { authFn, redirectToSignIn } = makeAuth(null)

      // Act
      const result = await handler(authFn, req(`http://localhost:3000${path}`))

      // Assert — public routes never get gated
      expect(redirectToSignIn).not.toHaveBeenCalled()
      expect(result).toBeUndefined()
    },
  )
})
