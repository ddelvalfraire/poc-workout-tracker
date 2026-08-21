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
  experimental: {
    // Enables React's <ViewTransition> for animated route changes.
    viewTransition: true,
  },
  // No SW headers entry needed anymore: the worker is served by the
  // /serwist/[path] route, which sets Service-Worker-Allowed: / itself, and
  // browsers bypass the HTTP cache for service-worker scripts by spec.
};

// Serwist (spike): enables the /serwist/[path] route that compiles app/sw.ts
// with the precache manifest injected. INERT until registration points at it
// (service-worker-register.tsx still registers /public/sw.js) — the wrapper
// only wires the build-asset manifest plumbing.
// Locale lives on the user, not the URL — so there is no [locale] segment and
// no intl middleware. The plugin's only job here is to wire src/i18n/request.ts
// into the build; routing, rewrites and the /_i proxy above are untouched.
const withNextIntl = createNextIntlPlugin();

export default withSerwist(withNextIntl(nextConfig));
