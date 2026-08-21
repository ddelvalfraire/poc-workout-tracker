import { afterEach, describe, expect, it, vi } from 'vitest'
import nextConfig from './next.config'

/**
 * Wiring test: src/lib/security-headers.test.ts proves the policy BUILDER;
 * this proves next.config actually mounts it on every route, through both
 * config wrappers (withSerwist, next-intl). The config reads env inside
 * headers() at call time, which is what lets these tests stub real values
 * instead of inheriting whatever .env.local leaked into the run (the same
 * hazard vitest.setup.ts documents for the VAPID keys).
 */

async function headersForAllRoutes() {
  const rules = await nextConfig.headers?.()
  const rule = rules?.find((r) => r.source === '/(.*)')
  expect(rule, 'a headers() rule covering every route').toBeDefined()
  return rule!.headers
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('next.config security headers', () => {
  it('mounts the full security header set on every route', async () => {
    const headers = await headersForAllRoutes()
    const byKey = Object.fromEntries(headers.map((h) => [h.key, h.value]))
    expect(byKey['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains; preload',
    )
    expect(byKey['X-Frame-Options']).toBe('DENY')
    expect(byKey['X-Content-Type-Options']).toBe('nosniff')
    expect(byKey['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(byKey['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()')
    // The env-independent spine of the CSP; the builder's own tests cover the
    // full directive set.
    expect(byKey['Content-Security-Policy']).toContain("default-src 'self'")
    expect(byKey['Content-Security-Policy']).toContain("frame-ancestors 'none'")
  })

  it('feeds the CSP from the same env vars the features read', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://wiring.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://k@o999.ingest.us.sentry.io/1')
    const headers = await headersForAllRoutes()
    const csp = headers.find((h) => h.key === 'Content-Security-Policy')!.value
    expect(csp).toContain("img-src 'self' blob: data: https://wiring.supabase.co")
    expect(csp).toContain("connect-src 'self' https://o999.ingest.us.sentry.io")
  })

  it('keeps production script-src free of eval and external hosts', async () => {
    // Stubbed explicitly: `next build`/`next start` pin NODE_ENV=production
    // themselves, but the test runner's ambient NODE_ENV is its own business
    // (vite hands this file 'development') — the branch under test must not
    // depend on it.
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    const headers = await headersForAllRoutes()
    const csp = headers.find((h) => h.key === 'Content-Security-Policy')!.value
    expect(csp).toContain("script-src 'self' 'unsafe-inline'; ")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('vercel.live')
  })
})
