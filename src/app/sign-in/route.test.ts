import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSignInUrl = vi.fn(async (_options?: { returnTo?: string }) => 'https://auth.example.com/authorize')
const redirect = vi.fn()

vi.mock('@workos-inc/authkit-nextjs', () => ({
  getSignInUrl: (options?: { returnTo?: string }) => getSignInUrl(options),
}))
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u) }))

import { GET } from './route'
import type { NextRequest } from 'next/server'

const req = (url: string) => ({ nextUrl: new URL(url) }) as unknown as NextRequest

beforeEach(() => {
  getSignInUrl.mockClear()
  redirect.mockClear()
})

describe('GET /sign-in', () => {
  it('carries redirect_url through so a shared link returns the visitor to it', async () => {
    // Arrange — the share pages link here with the path they want back.
    // Losing it drops signed-in visitors on the home page instead of the
    // program they followed a link to open.
    // Act
    await GET(req('http://localhost:3000/sign-in?redirect_url=%2Fp%2Ftok_abc'))

    // Assert
    expect(getSignInUrl).toHaveBeenCalledWith({ returnTo: '/p/tok_abc' })
  })

  it('refuses an off-site redirect_url rather than forwarding it', async () => {
    // Arrange — the query is attacker-controllable; a user who just
    // authenticated must not be bounced off-site.
    // Act
    await GET(req('http://localhost:3000/sign-in?redirect_url=https%3A%2F%2Fevil.example'))

    // Assert
    expect(getSignInUrl).toHaveBeenCalledWith({ returnTo: '/' })
  })

  it('defaults home when no redirect_url is given', async () => {
    // Act
    await GET(req('http://localhost:3000/sign-in'))

    // Assert
    expect(getSignInUrl).toHaveBeenCalledWith({ returnTo: '/' })
  })

  it('redirects to whatever AuthKit hands back', async () => {
    // Act
    await GET(req('http://localhost:3000/sign-in'))

    // Assert
    expect(redirect).toHaveBeenCalledWith('https://auth.example.com/authorize')
  })
})
