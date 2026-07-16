# Serwist PWA Layer — Structural Deploy-Skew Immunity + Real Offline

## Problem Statement

Every redeploy rotates hashed chunk filenames, and the installed PWA's open session references chunks that no longer exist. The current mitigation stack (update-on-resume probe, pre-boot chunk recovery, SW nav-retry, self-healing offline page — PR #68) makes the failure *recoverable*, but the failure still happens: a reload interrupts the user on every deploy, and mid-session taps can still hit dead chunks in the window before recovery. Vercel's Skew Protection solves this for $20/mo; the free structural fix is making old clients self-sufficient.

## Evidence

- User report 2026-07-15: "every single time we redeploy, white screen of death … needs a connection to load" — deterministic, diagnosed to the chunk-rotation → recovery-reload → radio-race chain.
- The assetPrefix-to-deployment-URL workaround is dead here: old deployment URLs 302 into Vercel's auth wall (tested).
- The app's draft layer is ALREADY offline-capable (autosave queue with offline retry) — but the shell can't boot offline, so that capability is unreachable in a basement gym.

## Proposed Solution

Adopt **Serwist** (`@serwist/next` + the Turbopack integration) with a deliberately narrow precache policy: **immutable build assets only** (`/_next/static/**`, icons, manifest, offline.html) — **never HTML or RSC payloads** (the v2 stale-shell lesson stays law). Each SW version carries its own chunk set, so an old client keeps working across deploys with zero dead chunks; the new version activates atomically when the old tabs close (no `skipWaiting`, matching current policy). Navigations stay network-first with the retry + self-healing offline fallback shipped in #68. The existing update-on-resume probe and pre-boot chunk recovery stay as the last-resort belt.

The prize beyond skew immunity: with the shell + chunks precached, the app can BOOT offline — combined with the existing draft queue, gym-basement logging becomes real.

## Key Hypothesis

We believe precaching versioned build assets will eliminate dead-chunk failures across deploys for open PWA sessions. We'll know we're right when a redeploy during an open session causes zero white screens, zero offline-page strands, and mid-session navigation keeps working on the old version until a natural reload.

## What We're NOT Building

- **HTML/RSC/data caching** — navigations and server data stay network-first, always. Non-negotiable house lesson.
- **skipWaiting/clientsClaim** — surprise activation under a live page is how stale-shell bugs are born; versions swap when tabs close.
- **Offline mutation queueing beyond the existing draft queue** — the draft layer already owns that.
- **Retiring the recovery belt (chunk-recovery, update-on-resume, offline self-heal)** — they become last-resort instead of primary; only provably-dead code gets removed later.
- **Vercel Skew Protection** — explicitly rejected on price.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Deploy-skew survival | Redeploy with an open session: no white screen, no offline strand, old session navigates fine | Manual: deploy while mid-session on the phone |
| Offline boot | Airplane-mode cold launch renders the app shell (auth'd routes degrade gracefully) | Manual |
| Precache hygiene | Zero HTML/RSC entries in the precache manifest | Assert on the generated manifest filter |
| No regression | Existing PWA suites (chunk-recovery, update-check, draft-sync) stay green untouched | npm test |

## Open Questions

- [ ] `@serwist/turbopack` stability on this exact Next version (16.2.x): a known `__SW_MANIFEST` injection bug existed in a 10.0.0 preview — Phase 1 is a spike that proves injection on OUR build before anything else moves. Fallback: build the SW via the `--webpack` path or a small esbuild step.
- [ ] Offline boot of a Clerk-authed app: what does `/` render offline (cached shell can't fetch RSC)? Phase 3 defines the honest offline UX — possibly offline boot stays on the (self-healing) offline page but with draft-safe messaging, or a lightweight cached resume surface.
- [x] Precache size: 2.24 MiB / 52 entries measured in the spike — comfortably inside iOS quotas.
- [ ] Phase 2 must confirm the Clerk middleware does NOT gate `/serwist/sw.js` (a redirected SW-script fetch breaks registration) — add a middleware exclusion if it does.

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Spike: manifest injection | PROVEN 2026-07-16 on Next 16.2/Turbopack: `serwist`/`@serwist/turbopack` pinned **9.5.11** (stable — the injection bug was a 10.0 preview); build reports "52 precache entries (2293.79 KiB)"; emitted worker verified: manifest = `/_next/static/**` + offline.html ONLY, `skipWaiting:false` compiled in; route prerenders static; inert (nothing registers /serwist/sw.js yet) | complete | - | - | - |
| 2 | Precache-only SW swap | SHIPPED 2026-07-16 (PR #70): registration → /serwist/sw.js (root scope; route serves Service-Worker-Allowed), public/sw.js retired, legacy cache cleaned on activate; middleware ungated (matcher skips *.js); nav semantics identical (#68); recovery belt untouched; verified live on prod | complete | - | 1 | - |
| 3 | Offline UX + cleanup | Define/ship the honest offline-boot experience; measure precache footprint; retire only provably-dead recovery code; document the layer | pending | - | 2 | - |

### Phase Details

**Phase 1 — Spike (small, throwaway-safe)**
Goal: kill the only real unknown (Turbopack injection on 16.2) before committing anything. Success: a built SW containing a real manifest, inspected; version pins recorded in the PRD.

**Phase 2 — The swap (the feature)**
Goal: skew immunity with behavioral parity on everything else. The generated SW replaces `public/sw.js`; the #68 navigation semantics are re-expressed on Serwist primitives (or kept as hand-rolled handlers alongside the precache — whichever keeps the diff honest); update-on-resume + chunk recovery untouched. Acceptance test: deploy while mid-session on the phone.

**Phase 3 — Offline as a feature, then cleanup**
Goal: make the precached shell mean something (offline cold-launch story), then delete only what the new layer provably obsoletes.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Library | Serwist (`@serwist/next` + turbopack path) | next-pwa (stale lineage), hand-rolled Workbox, Vercel Skew Protection ($) | Maintained successor, first-class Next/Turbopack docs, free |
| Precache scope | Immutable build assets ONLY | Serwist defaultCache (caches pages/data) | The v2 stale-shell white screens are this layer's founding lesson; HTML/RSC stay network-first |
| Activation | No skipWaiting; swap on tab close | skipWaiting + reload prompt | Matches current policy; a surprise reload mid-set is the worst outcome |
| Recovery belt | Keep all of it through Phase 2 | Rip out in the same PR | This layer has bitten twice (v2 shell, #68 strand); smallest reversible steps |
| Rollout | Spike → swap → offline | Big-bang | Same reasoning |

## Research Summary

Serwist is the maintained Workbox-lineage successor to next-pwa with [first-class Next.js docs](https://serwist.pages.dev/docs/next/getting-started) and a [dedicated Turbopack integration](https://www.npmjs.com/package/@serwist/turbopack) for Next 16 (Turbopack-default) apps — dev testing uses the `--webpack` flag. A [`__SW_MANIFEST` injection bug in a 10.0.0 preview](https://github.com/serwist/serwist/issues/294) motivates the version-pinning spike. Community confirmation of the App Router + Next 16 path: [LogRocket on Next 16 offline PWAs](https://blog.logrocket.com/nextjs-16-pwa-offline-support/).

In-repo: `public/sw.js` (network-first + retry + offline fallback, #68), `src/lib/pwa/chunk-recovery.ts` (tested pre-boot recovery), `update-on-resume.tsx` (version probe), `service-worker-register.tsx`; the draft queue is already offline-retrying (`draft-sync.ts`). The never-cache-HTML rule is documented in sw.js's comments and project memory.

---

*Generated: 2026-07-15 · Status: DRAFT — Phase 1 spike de-risks before any commitment*
