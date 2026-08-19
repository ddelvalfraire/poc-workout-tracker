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

// --- PostHog (same idiom as Sentry above: env-gated lazy chunk) ------------
//
// Anonymous-by-default posture: person_profiles 'identified_only' means no
// person profile exists until identify() is called — and identify() is NOT
// called anywhere yet (it lands with the consent step). Until then every
// event is anonymous. Session recording stays off for the same reason.
//
// Health-data rule (MHMDA): no workout content ever goes into event
// properties — server events enforce this by type in @/lib/analytics; the
// client sends only pageviews/pageleaves here.

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY

if (posthogKey) {
  void import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(posthogKey, {
        // First-party proxy path (rewritten in next.config.ts) so ad blockers
        // don't eat the funnel; ui_host points links in PostHog's UI home.
        api_host: '/_i',
        ui_host: 'https://us.posthog.com',
        // Version-dated defaults preset: enables 'history_change' pageviews
        // (SPA navigations captured without manual router wiring) among other
        // current-recommended behaviors.
        defaults: '2026-06-25',
        // The logger is a chatty click surface; autocapture would burn the
        // event budget on noise. The tracking plan's named events are the
        // signal.
        autocapture: false,
        // Off until the consent step ships; replays of the logger would show
        // workout content.
        disable_session_recording: true,
        // Explicit even though it's the default: this is the anonymous-until-
        // consent posture in one line.
        person_profiles: 'identified_only',
      })
    })
    .catch((error: unknown) => console.error('[posthog] client init failed', error))
}
