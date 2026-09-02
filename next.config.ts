import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaders } from "./src/lib/security-headers";

// Baked into BOTH bundles at build time: the client compares its copy against
// /api/version (answered by the newest deployment) to detect a stale build —
// the update-on-resume probe. Vercel provides the commit SHA; local prod
// builds fall back to a build-time stamp so the mechanism still works.
// ASSUMES one build artifact serves all instances (true on Vercel): if
// replicas ever build independently, the timestamp fallback would bake a
// DIFFERENT id per replica and mismatch forever — derive from content, not
// wall clock, before self-hosting multi-instance.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA ?? `local-${Date.now()}`;

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  experimental: {
    // Every signed-in route is dynamic (it reads the session), and Next's
    // client cache holds dynamic pages for 0s by default — so home → Programs
    // → home paid a full server round trip on the way back. 30s of reuse for
    // a page the user just left, matching the TanStack staleTime the client
    // islands already use. Correctness: every in-app write is a server
    // action that calls revalidatePath (any path, any scope — Next treats a
    // revalidated path as a tag and the client then evicts its ENTIRE
    // prefetch cache: action-handler.js "paths are treated as tags" →
    // ActionDidRevalidateStaticAndDynamic → invalidateEntirePrefetchCache).
    // Only writes made outside the app (the MCP server) can show up to 30s
    // late, the same window the drawer already accepts. The three actions
    // without a revalidate call (welcome consent, account deletion, the
    // entitlement grant) all end in a redirect or hard navigation.
    staleTimes: { dynamic: 30 },
  },
  // PostHog ingest reverse proxy: first-party /_i/* so ad blockers (which eat
  // 25-35% of direct third-party analytics requests) don't blind the funnel.
  // Path is deliberately short and non-obvious — blockers pattern-match
  // /analytics, /posthog, /tracking. US Cloud hosts; assets host is separate
  // from the ingest host per PostHog's proxy docs.
  async rewrites() {
    return [
      {
        source: "/_i/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/_i/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  // PostHog API paths end in slashes (/e/, /flags/); without this Next would
  // 308-redirect them to the slashless form before the rewrite applies.
  // GLOBAL flag — src/proxy.ts re-provides the 308 for every non-/_i path, so
  // the rest of the app (share links especially) keeps its old behavior.
  skipTrailingSlashRedirect: true,
  // CSP + the transport/framing/sniffing set, on every response. The policy
  // and its rationale (why 'unsafe-inline' and not a nonce, which env var
  // feeds which allowance) live in src/lib/security-headers.ts; env is read
  // here at call time so the wiring test can exercise real values.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders({
          isDev: process.env.NODE_ENV === "development",
          isPreview: process.env.VERCEL_ENV === "preview",
          supabaseUrl: process.env.SUPABASE_URL,
          sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        }),
      },
    ];
  },
  // `experimental.viewTransition` was REMOVED in Next 16.3 — the key no longer
  // exists on ExperimentalConfig and setting it is a type error. The feature
  // did not go away: the App Router runs React's canary channel, which ships
  // <ViewTransition> natively, so components/page-transition.tsx keeps working
  // with no opt-in. (16.3 adds unrelated `gestureTransition` and
  // `transitionIndicator` keys — neither is a rename of this one.)
  // No SW headers entry needed anymore: the worker is served by the
  // /serwist/[path] route, which sets Service-Worker-Allowed: / itself, and
  // browsers bypass the HTTP cache for service-worker scripts by spec.
};

// Serwist: enables the /serwist/[path] route that compiles app/sw.ts with the
// precache manifest injected. This is the LIVE worker, not a spike —
// components/pwa/service-worker-register.tsx registers '/serwist/sw.js'
// through @serwist/window, and public/ holds no service worker at all.
// Locale lives on the user, not the URL — so there is no [locale] segment and
// no intl middleware. The plugin's only job here is to wire src/i18n/request.ts
// into the build; routing, rewrites and the /_i proxy above are untouched.
const withNextIntl = createNextIntlPlugin();

export default withSerwist(withNextIntl(nextConfig));
