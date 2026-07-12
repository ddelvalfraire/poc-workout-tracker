# PR Review: #26 — fix: recover from stale-deploy chunks instead of white-screening

**Reviewed**: 2026-07-08
**Author**: ddelvalfraire
**Branch**: fix/pwa-stale-shell-recovery → main
**Decision**: REQUEST CHANGES → resolved (all HIGH findings fixed in 9d57092)

## Summary
The design (never cache app HTML, chunk-free offline page, pre-boot inline recovery) is sound, but the review found the recovery mechanisms themselves had two concrete defects and no test coverage. All fixed in-branch.

## Findings

### CRITICAL
None

### HIGH
- **[FIXED]** Reload throttle failed OPEN when sessionStorage threw (partitioned storage/quota/policy): `last` stayed 0 forever → unthrottled reload loop against a persistently broken deploy. Now fails closed: unreadable or unwritable storage skips the reload entirely.
- **[FIXED]** A failed install-time precache of `/offline.html` silently disabled the entire offline fallback for the SW version's lifetime (`respondWith(undefined)` → browser error page). The SW now re-checks on activate and backfills on successful navigations (`ensureOfflinePageCached`).
- **[FIXED]** Zero test coverage for the recovery logic. The script moved to `src/lib/pwa/chunk-recovery.ts`; `chunk-recovery.test.ts` executes the exact shipped string with stubbed globals (stale script, ChunkLoadError, unrelated events, 30s window boundary, both fail-closed storage cases). 6 tests.

### MEDIUM
- Rollout gap (accepted trade-off, documented): already-installed v2 clients keep the old SW until the app is fully killed — no `skipWaiting()` by design (a mid-session worker swap can destroy the in-memory draft). First-deploy verification must force-quit the PWA between deploy and resume.

### LOW
- ChunkRecoveryScript's must-be-first-in-body ordering is enforced only by a comment. Accepted.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass (688, 6 new) |
| Build | Pass |

## Files Reviewed
- public/sw.js — Modified
- public/offline.html — Added
- src/lib/pwa/chunk-recovery.ts — Added (fix commit)
- src/lib/pwa/chunk-recovery.test.ts — Added (fix commit)
- src/components/pwa/chunk-recovery-script.tsx — Added
- src/components/pwa/service-worker-register.tsx — Modified
- src/app/layout.tsx — Modified
