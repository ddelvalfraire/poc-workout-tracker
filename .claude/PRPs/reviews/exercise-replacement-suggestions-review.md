# Code Review: Exercise Replacement — Muscle-Matched Suggestions (Phase 2)

**Reviewed**: 2026-07-14
**Branch**: feat/exercise-replacement-suggestions (uncommitted, local review)
**Decision**: APPROVE

## Summary
Zero findings at any severity. The reviewer targeted the highest-value risk first — a silently-always-empty rail if the wger proxy stripped or renamed muscle/equipment fields — and verified it clean: `mapExercise` (`src/lib/wger.ts:141-149`) populates `muscles`/`musclesSecondary`/`equipment` under exactly the names the ranker reads, and `/api/exercises?all=1` passes the mapped objects through unmodified.

## Findings

### CRITICAL / HIGH / MEDIUM / LOW
None.

## Reviewer verification highlights
- **Data reality**: field names verified end-to-end (wger mapping → API route → picker) — the empty-rail failure mode that unit tests cannot catch is ruled out.
- **Ranker**: scoring matches the stated 3/2/1/−1 weights; the 11 tests would catch weight regressions (e.g. category outranking primary overlap), tiebreak breaks, and filter regressions.
- **Integration**: useMemo deps correct; rail gated to replace mode + empty query; program builder's inline picker confirmed rail-free; `ExerciseResult → AlternativeCandidate → addExercise` structural chain sound.
- **Guard preserved**: rail taps route through the same `addExercise → onAdd → handleReplacePick` path as search picks — the completed-sets guard applies uniformly.
- **a11y**: rail correctly OUTSIDE the combobox model (aria-expanded/activedescendant untouched); its Add buttons are natively tabbable.
- **Custom-exercise degrade**: a negative-id (custom stopgap) replace target finds no catalog match → `[]` → search-only, the documented fallback.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass — 976 (11 new) |
| Build | Pass |

## Files Reviewed
- `src/lib/exercise-alternatives.ts` — Added
- `src/lib/exercise-alternatives.test.ts` — Added
- `src/app/workout/new/exercise-picker.tsx` — Modified
- `src/app/workout/new/exercise-sheet.tsx` — Modified
- `src/app/workout/new/workout-logger.tsx` — Modified
- `.claude/PRPs/prds/exercise-replacement.prd.md` — Modified (docs)
