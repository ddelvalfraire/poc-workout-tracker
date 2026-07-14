# Code Review: PWA Update Handling (fix/pwa-update-handling)

**Reviewed**: 2026-07-13
**Branch**: fix/pwa-update-handling (local, pre-commit)
**Reviewer**: typescript-reviewer agent (initial pass + fix re-verification) + validation suite
**Decision**: APPROVE (initial BLOCK resolved and re-verified in-session)

## Summary
Proactive update-on-resume probe (B) + hardened reactive chunk recovery (C) for the recurring white-screen-after-deploy problem. The reviewer's initial BLOCK found a genuine CRITICAL — the new proactive path shipped without the reload-storm protection this very PR added to the reactive path — fixed TDD-style and re-verified by the same reviewer.

## Findings

### CRITICAL
- `update-on-resume.tsx` — no cross-reload guard: `useRef` throttle state dies with `location.reload()`, so a mid-deploy CDN window (stale HTML edge + fresh `/api/version`) or a wedged deploy loops reloads indefinitely. **Fixed**: `shouldReloadForUpdate` + `parseReloadStamp` (6 new tests) — one reload per deployed build id per 5-min cooldown, persisted in sessionStorage BEFORE the reload (synchronous, no yield point — re-verified no race); new deploy id gets a fresh attempt; storage unavailable → fail closed (reactive script remains the net). Worst case for a wedged deploy: 1 reload / 5 min / tab — stale-but-usable, not a loop.

### HIGH
- `next.config.ts` — `local-${Date.now()}` fallback bakes a different id per replica in any multi-instance build topology → permanent false mismatch. **Fixed** (documentation): explicit single-build-artifact assumption comment (Vercel-only today); content-derived id required before multi-instance self-hosting.

### MEDIUM
- `/api/version` relied on inferred no-cache behavior. **Fixed**: explicit `Cache-Control: no-store` (defense-in-depth over `force-dynamic`).
- Blind `as { buildId?: unknown }` cast on the probe response. **Fixed**: shape check before use; `isUpdateAvailable` made a `deployed is string` type predicate (kills the follow-on cast entirely).

### LOW
None.

## Verified clean (both passes)
- Recovery script stays pure ES5 (var-only, injected-constructor `instanceof`); artifact-executing test harness runs the exact shipped string with faithful new stubs (HTMLLinkElement, navigator).
- `navigator.onLine === false` guard prevents reload-to-offline-page; storage-unavailable path now reloads exactly once per page lifetime (was fail-closed/never).
- Generic "Failed to fetch" rejections deliberately NOT reload-worthy (offline API calls are not skew; the probe owns proactive updates).
- `env.NEXT_PUBLIC_BUILD_ID` inlining: same literal baked into client and server bundles from one build — the comparison is same-build vs newest-deployment by construction.
- Middleware `/api/version` public-route match exact; probe unaffected by auth state.
- Protected-path (live logger) reload skip reads pathname at decision time — race window effectively zero.
- Check throttle (in-memory, 60s) and reload guard (persisted, 5 min) are independent and composable — verified interaction.

## Validation Results (post-fix)

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass — 935/935 (23 PWA: 11 recovery + 12 update-check) |
| Build | Pass — `ƒ /api/version` in route list |

## Files Reviewed
- `src/lib/pwa/chunk-recovery.ts` / `.test.ts` — Modified (hardened + 5 new cases)
- `src/lib/pwa/update-check.ts` / `.test.ts` — Added (pure helpers, 12 tests)
- `src/components/pwa/update-on-resume.tsx` — Added
- `src/app/api/version/route.ts` — Added
- `next.config.ts` — Modified (baked build id)
- `src/proxy.ts` — Modified (public route)
- `src/app/layout.tsx` — Modified (mount)
