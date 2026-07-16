import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

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
export default withSerwist(nextConfig);
