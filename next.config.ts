import type { NextConfig } from "next";

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
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
