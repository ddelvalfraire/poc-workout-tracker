# Review: Exercise Stats — Phase 3: Logger Sheet (PR #58)

**Reviewed**: 2026-07-15
**Branch**: feat/exercise-stats-logger-sheet → main
**Decision**: APPROVE (after fixes applied)

## Summary
Name-tap stats sheet in the logger. Reviewer verified the dialog recipe is byte-identical to rest/plate sheets (no drift), the 'use server' type export is valid, query states are exhaustive, and the action tests cover the validation boundary. No CRITICAL/HIGH. 1 MEDIUM + 2 LOW; MEDIUM and one LOW fixed pre-merge.

## Findings

### CRITICAL / HIGH
None.

### MEDIUM (FIXED)
1. **Index-addressed sheets go stale under an async draft restore** — a cross-device `RESTORE_DRAFT` landing while a sheet is open silently repoints `statsSheetFor`/`plateSheetFor` at a different exercise. (Remove/replace can't race — the modal makes the page inert; the restore is the one reachable window. Pre-existing gap for `plateSheetFor`, duplicated by this PR.) Fixed: both sheet indices cleared in the restore effect alongside `replaceTargetIndex`.

### LOW
2. **Name-button tap target ~24px** (FIXED) — invisible `-my-1.5 py-1.5` inset bumps the hit area without moving layout. (A `//`-comment-in-JSX syntax slip during this fix was caught by lint and removed.)
3. **Error state has no retry affordance** (ACCEPTED) — "close and reopen" matches the sheet's quiet, read-only framing; not blocking.

## Validation Results
| Check | Result |
|---|---|
| tsc --noEmit | Pass |
| eslint (changed files) | Pass |
| Tests | Pass — 68 files / 1014 (24 in actions suite) |
| Build | Pass |

## Files Reviewed
actions.ts, actions.test.ts, stats-sheet.tsx, workout-logger.tsx (+ rest-sheet/plate-sheet/exercise-stats as references).
