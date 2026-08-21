import { describe, expect, it } from 'vitest'
import {
  buildContentSecurityPolicy,
  securityHeaders,
  type SecurityHeaderInput,
} from './security-headers'

/**
 * The CSP is a single opaque string in transit, so these tests read it back
 * directive by directive: an exact-match on each directive is what catches
 * both a dropped source (photos stop loading) and a smuggled one (an exfil
 * host quietly allowed). The env-derived sources are asserted with synthetic
 * values — the point is the DERIVATION (origin, not full URL), not any real
 * project host.
 */

const PROD: SecurityHeaderInput = {
  isDev: false,
  isPreview: false,
  supabaseUrl: 'https://abc123.supabase.co',
  sentryDsn: 'https://k3y@o111.ingest.us.sentry.io/222',
}

function directive(csp: string, name: string): string | undefined {
  return csp.split('; ').find((entry) => entry === name || entry.startsWith(`${name} `))
}

describe('buildContentSecurityPolicy', () => {
  it('locks the injection primitives regardless of environment', () => {
    const csp = buildContentSecurityPolicy(PROD)
    expect(directive(csp, 'default-src')).toBe("default-src 'self'")
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'")
    expect(directive(csp, 'object-src')).toBe("object-src 'none'")
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'")
    expect(directive(csp, 'form-action')).toBe("form-action 'self'")
    expect(directive(csp, 'worker-src')).toBe("worker-src 'self'")
    expect(directive(csp, 'manifest-src')).toBe("manifest-src 'self'")
    expect(directive(csp, 'font-src')).toBe("font-src 'self'")
  })

  it('production scripts allow no external host and no eval', () => {
    const csp = buildContentSecurityPolicy(PROD)
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline'")
  })

  it('images: self, local blob/data URIs, and exactly the Supabase project origin', () => {
    const csp = buildContentSecurityPolicy(PROD)
    expect(directive(csp, 'img-src')).toBe(
      "img-src 'self' blob: data: https://abc123.supabase.co",
    )
  })

  it('connect: self plus exactly the Sentry ingest ORIGIN (key and project stripped)', () => {
    const csp = buildContentSecurityPolicy(PROD)
    expect(directive(csp, 'connect-src')).toBe(
      "connect-src 'self' https://o111.ingest.us.sentry.io",
    )
  })

  it('absent env narrows the policy instead of widening or throwing', () => {
    const csp = buildContentSecurityPolicy({ isDev: false, isPreview: false })
    expect(directive(csp, 'img-src')).toBe("img-src 'self' blob: data:")
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'")
  })

  it('malformed env urls are dropped, not thrown into the build', () => {
    const csp = buildContentSecurityPolicy({
      isDev: false,
      isPreview: false,
      supabaseUrl: 'not a url',
      sentryDsn: '://also-broken',
    })
    expect(directive(csp, 'img-src')).toBe("img-src 'self' blob: data:")
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'")
  })

  it('an env value can never rewrite the policy grammar', () => {
    // new URL() ACCEPTS all three of these; a CSP cannot carry any of them.
    // ';' ends a directive and starts a new one, ',' splits the header into a
    // second policy, and a non-special scheme (the pasted-connection-string
    // mistake) serializes its origin as the literal string "null".
    const csp = buildContentSecurityPolicy({
      isDev: false,
      isPreview: false,
      supabaseUrl: 'https://evil.example;sandbox',
      sentryDsn: 'postgres://user:pass@db.evil.example:5432/app',
    })
    expect(directive(csp, 'img-src')).toBe("img-src 'self' blob: data:")
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'")
    expect(csp).not.toContain('sandbox')
    expect(csp).not.toContain('null')

    const comma = buildContentSecurityPolicy({
      isDev: false,
      isPreview: false,
      supabaseUrl: 'https://evil.example,default-src',
    })
    expect(directive(comma, 'img-src')).toBe("img-src 'self' blob: data:")
    expect(comma).not.toContain(',')
  })

  it('still admits the local-stack Supabase origin (http + port)', () => {
    const csp = buildContentSecurityPolicy({
      isDev: true,
      isPreview: false,
      supabaseUrl: 'http://127.0.0.1:54321',
    })
    expect(directive(csp, 'img-src')).toBe("img-src 'self' blob: data: http://127.0.0.1:54321")
  })

  it('dev adds eval (react-refresh) and the HMR websocket, nothing more', () => {
    const dev = buildContentSecurityPolicy({ ...PROD, isDev: true })
    expect(directive(dev, 'script-src')).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'")
    expect(directive(dev, 'connect-src')).toBe(
      "connect-src 'self' https://o111.ingest.us.sentry.io ws:",
    )
    // The rest of the policy is byte-identical to production.
    const prod = buildContentSecurityPolicy(PROD)
    for (const name of ['img-src', 'style-src', 'frame-src', 'frame-ancestors']) {
      expect(directive(dev, name)).toBe(directive(prod, name))
    }
  })

  it('preview builds admit the vercel.live toolbar surfaces only', () => {
    const csp = buildContentSecurityPolicy({ ...PROD, isPreview: true })
    expect(directive(csp, 'script-src')).toBe(
      "script-src 'self' 'unsafe-inline' https://vercel.live",
    )
    expect(directive(csp, 'frame-src')).toBe('frame-src https://vercel.live')
    expect(directive(csp, 'connect-src')).toBe(
      "connect-src 'self' https://o111.ingest.us.sentry.io https://vercel.live wss://*.pusher.com",
    )
    // Verbatim from Vercel's toolbar CSP doc: toolbar fonts come from
    // assets.vercel.com, everything else it needs rides vercel.live.
    expect(directive(csp, 'font-src')).toBe(
      "font-src 'self' https://vercel.live https://assets.vercel.com",
    )
    // The clickjacking stance never loosens, preview or not.
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'")
  })
})

describe('securityHeaders', () => {
  it('ships the full set with the exact transport/framing/sniffing values', () => {
    const headers = securityHeaders(PROD)
    expect(headers.map((h) => h.key)).toEqual([
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ])
    const byKey = Object.fromEntries(headers.map((h) => [h.key, h.value]))
    expect(byKey['Content-Security-Policy']).toBe(buildContentSecurityPolicy(PROD))
    expect(byKey['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains; preload',
    )
    expect(byKey['X-Frame-Options']).toBe('DENY')
    expect(byKey['X-Content-Type-Options']).toBe('nosniff')
    expect(byKey['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(byKey['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()')
  })
})
