/**
 * Client-side Sentry init (Next's instrumentation-client convention file).
 *
 * Next loads this on every page, so the SDK arrives via dynamic import ONLY
 * when a DSN was baked in at build time: unconfigured builds ship just this
 * stub (the statically-false branch is dead code); configured builds load the
 * Sentry chunk (~30 kB gzip) lazily after hydration. Tradeoff: errors thrown
 * before that chunk resolves are missed — accepted for the bundle win.
 */

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

type RouterTransitionStart = (href: string, navigationType: string) => void

let sentryRouterTransitionStart: RouterTransitionStart | undefined

if (dsn) {
  void import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
        // Low sample: errors are the point; traces are a free-tier budget item.
        tracesSampleRate: 0.1,
        // Deliberately no session replay: heavy extra bundle + tiny free quota.
      })
      sentryRouterTransitionStart = Sentry.captureRouterTransitionStart
    })
    .catch((error: unknown) => console.error('[sentry] client init failed', error))
}

// Next calls this on every App Router navigation; forwards to Sentry once the
// lazy chunk has resolved, no-ops (losing at most the first hop) before then.
export const onRouterTransitionStart: RouterTransitionStart = (href, navigationType) => {
  sentryRouterTransitionStart?.(href, navigationType)
}
