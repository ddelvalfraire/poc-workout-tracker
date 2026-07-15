# Code Review: Exercise Replacement — Substitute Targets (Phase 3)

**Reviewed**: 2026-07-14
**Branch**: feat/exercise-replacement-substitute-targets (uncommitted, local review)
**Decision**: APPROVE

## Summary
Zero actionable findings. The reviewer's core job was leak-hunting — can ANY original-movement load reach the substitute's derived targets? — and the answer is no, verified path-by-path: all 7 progression schemes checked against `schemeLoad` (only the two TM-based ones carry `trainingMaxKg`, both dropped); base-anchored schemes yield null loads once the template base is stripped; the deload multiplier short-circuits on null; `applyOverride` only writes loads from non-null override values, which are also stripped; technique-stage `loadKg` never maps into `PlanSetTarget`.

## Findings

### CRITICAL / HIGH / MEDIUM
None.

### LOW (noted, no action)
- `planFor` is re-created per render — an object lookup, harmless; flagged only against copying the pattern with heavier logic.
- Orphaned `planOverrides` entries after undo/re-swap — inert dead state, never read again; consistent with the accepted reload/double-swap tradeoffs.

## Reviewer verification highlights
- **Type reality**: `getProgramDayDetail`'s Drizzle result structurally satisfies `SlotForSubstitution`/`DayForDerivation` with no `as` casts; `progression` is `$type<Progression>()`, overrides carry `week`.
- **Ownership**: both `getWorkoutDetail` and `getProgramDayDetail` enforce userId gates; the action adds input-shape guards on top.
- **Async safety**: functional `setPlanOverrides` updater — no stale closure from the best-effort `.then`.
- **Tests**: the override-strip and scheme-classification tests would catch a missed strip path or a misclassified scheme in either direction.
- **Cost**: one derivation per user-gesture swap, same class as the edit page's `loadPlanTargets`.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass — 982 (6 new) |
| Build | Pass |

## Files Reviewed
- `src/lib/substitute-slot.ts` — Added
- `src/lib/substitute-slot.test.ts` — Added
- `src/app/workout/actions.ts` — Modified
- `src/app/workout/new/workout-logger.tsx` — Modified
- `.claude/PRPs/prds/exercise-replacement.prd.md` — Modified (docs)
