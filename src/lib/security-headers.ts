/**
 * App-wide security response headers, wired into every route by
 * next.config.ts `headers()`.
 *
 * Everything here is computed at BUILD time — Next bakes `headers()` output
 * into the deployment's routing table, so every source must be knowable from
 * build env, never per-request. That is also why script-src carries
 * 'unsafe-inline' instead of a nonce: a nonce needs every page dynamically
 * rendered, and this app deliberately keeps /terms, /privacy, /health-privacy
 * and public/offline.html static — src/app/layout.test.ts fails the build if
 * a request read creeps into the root layout. Their inline bootstrap scripts
 * (Next's hydration payload, ChunkRecoveryScript) are stamped at build and can
 * never carry a per-request nonce. 'self' + 'unsafe-inline' still shuts every
 * EXTERNAL script host, which is the loading surface this app actually has.
 * (Do not "improve" this by adding a hash or nonce alongside: their presence
 * makes browsers ignore 'unsafe-inline', breaking every other inline script.)
 *
 * The directives that earn their exceptions:
 * - img-src: ThumbHash placeholders paint from data: URIs, progress photos
 *   load from short-lived signed URLs on the Supabase project host — derived
 *   from the SAME env var that mints the signatures (src/lib/supabase-storage
 *   reads SUPABASE_URL), so the policy and the feature cannot drift apart.
 *   blob: only names bytes already in the page (local previews), it widens
 *   nothing.
 * - connect-src: the browser Sentry SDK posts events straight to the DSN's
 *   ingest origin (src/instrumentation-client.ts — no tunnel route). PostHog
 *   needs no entry: ingest AND asset loads ride the first-party /_i/*
 *   rewrite, so the browser only ever talks to 'self'.
 * - frame-ancestors 'none' (+ X-Frame-Options DENY for old engines): the app
 *   performs state-changing Server Actions behind session cookies — nothing
 *   may frame it.
 * - Vercel preview deploys inject the vercel.live toolbar; production gets
 *   none of those allowances.
 */

export interface SecurityHeaderInput {
  /** `next dev` needs eval (react-refresh) and the HMR websocket. */
  isDev: boolean
  /** Vercel preview deploys inject the vercel.live feedback toolbar. */
  isPreview: boolean
  /** SUPABASE_URL — progress photos are signed URLs on this project host. */
  supabaseUrl?: string
  /** NEXT_PUBLIC_SENTRY_DSN — browser events post to the DSN's ingest origin. */
  sentryDsn?: string
}

const VERCEL_TOOLBAR = 'https://vercel.live'

/**
 * A malformed or absent env var narrows the policy instead of throwing:
 * the feature that reads the same var is equally dead in that build, so the
 * missing allowance costs nothing — and a headers() throw would fail every
 * build for a reason unrelated to what is being built.
 */
function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

export function buildContentSecurityPolicy(input: SecurityHeaderInput): string {
  const { isDev, isPreview } = input
  const supabaseOrigin = originOf(input.supabaseUrl)
  const sentryOrigin = originOf(input.sentryDsn)

  const directives: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['default-src', ["'self'"]],
    [
      'script-src',
      [
        "'self'",
        "'unsafe-inline'",
        ...(isDev ? ["'unsafe-eval'"] : []),
        ...(isPreview ? [VERCEL_TOOLBAR] : []),
      ],
    ],
    // 'unsafe-inline' for styles: React style props render as style
    // attributes, and next/font inlines its @font-face rules.
    ['style-src', ["'self'", "'unsafe-inline'", ...(isPreview ? [VERCEL_TOOLBAR] : [])]],
    [
      'img-src',
      [
        "'self'",
        'blob:',
        'data:',
        ...(supabaseOrigin ? [supabaseOrigin] : []),
        ...(isPreview ? [VERCEL_TOOLBAR, 'https://vercel.com'] : []),
      ],
    ],
    // next/font self-hosts Google Fonts at build time; nothing loads from
    // fonts.gstatic.com at runtime.
    ['font-src', ["'self'", ...(isPreview ? [VERCEL_TOOLBAR] : [])]],
    [
      'connect-src',
      [
        "'self'",
        ...(sentryOrigin ? [sentryOrigin] : []),
        ...(isDev ? ['ws:'] : []),
        ...(isPreview ? [VERCEL_TOOLBAR, 'wss://*.pusher.com'] : []),
      ],
    ],
    // The serwist service worker is served same-origin by /serwist/[path].
    ['worker-src', ["'self'"]],
    // src/app/manifest.ts serves the PWA manifest same-origin.
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    // The app embeds nothing; the preview toolbar is the lone exception.
    ['frame-src', isPreview ? [VERCEL_TOOLBAR] : ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'self'"]],
    // Forms are Server Actions posting to their own origin; AuthKit flows are
    // redirects (navigations), which form-action does not govern.
    ['form-action', ["'self'"]],
  ]

  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ')
}

/** The full header set, in the shape next.config.ts `headers()` expects. */
export function securityHeaders(
  input: SecurityHeaderInput,
): Array<{ key: string; value: string }> {
  return [
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(input) },
    // Browsers ignore HSTS over plain http, so dev is unaffected; sending it
    // unconditionally keeps the output deterministic.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
    // Redundant with frame-ancestors for every evergreen browser; kept for
    // the engines that predate CSP2.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // The photo flow uses <input type="file">, which needs no camera grant;
    // nothing in the app touches these APIs.
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ]
}
