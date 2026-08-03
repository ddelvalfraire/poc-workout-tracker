# PR Review: #145 — refactor: React.cache() readers + self-fetching home sections

**Reviewed**: 2026-08-03
**Author**: ddelvalfraire
**Branch**: refactor/request-memo-reads → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The refactor's correctness hinges on three things and all three hold.
(1) Cache-key hygiene: the silent failure mode of React.cache() is a
fresh object/Date arg per call making every call a miss — the PR hunts
those down (Date → optional epoch-ms; the VolumeWindows object → a
per-user derived wrapper) and documents each as an in-code constraint.
(2) Staleness surface: grep-verified that no server action calls a
wrapped reader, so read-after-write staleness within a request is
structurally impossible; cross-request there is nothing to invalidate
by construction. (3) Query parity: traced read-by-read — same 7
top-level reads per home request, with MomentumPanel's overlapping
reads landing as memo hits. The listWorkoutSummaries split (raw builder
export kept for the SQL-shape authorization test) shows the right
instinct: caching the awaited result, not the builder. The omitted
memoization unit test is honestly documented (React 19's cache is a
passthrough outside a react-server dispatcher; scaffolding the
react-server condition into vitest isn't worth it) — the parity trace
and types carry the burden instead.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- getRollingVolumeTotals mints its own Date per cache miss — matches
  prior per-call-site behavior exactly; noted as intentional.
- /stats calendar-mode callers keep unwrapped getVolumeTotals (object
  arg) — correct scoping; wrapping would be fake memoization.
- Pattern proven on MomentumPanel only; other pages left as-is by
  design (no drive-by refactors).

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 157 files, 2201 tests |
| Build | Pass |
| Migration | None |

## Files Reviewed
- src/db/workouts.ts, workout-drafts.ts, programs.ts, preferences.ts,
  muscle-volume.ts — Modified: cache() wraps + builder split + wrapper
- src/lib/check-in.ts, goals.ts — Modified: epoch-ms normalization
- src/app/page.tsx, momentum-panel.tsx — Modified: self-fetching section
- src/app/api/drawer/route.ts, cron route — Modified: primitive now args
- workouts.test.ts, check-in.test.ts — Modified: signature deltas
