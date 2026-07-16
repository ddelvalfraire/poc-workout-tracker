import { spawnSync } from 'node:child_process'
import { createSerwistRoute } from '@serwist/turbopack'

/**
 * Serves the Serwist-compiled worker (src/app/sw.ts) at /serwist/sw.js with
 * the precache manifest injected at build time. SPIKE STATE: nothing
 * registers this URL yet — service-worker-register.tsx still points at
 * /sw.js — so the route is inert plumbing that Phase 2 flips registration
 * onto.
 *
 * The offline page is precached with a content-stable revision (the commit
 * SHA): it only changes when a deploy changes it.
 */
const revision =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  (spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout || 'dev').trim()

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: '/offline.html', revision }],
    swSrc: 'src/app/sw.ts',
    useNativeEsbuild: true,
  })
