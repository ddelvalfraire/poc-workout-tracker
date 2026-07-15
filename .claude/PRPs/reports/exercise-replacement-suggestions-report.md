# Implementation Report: Exercise Replacement — Muscle-Matched Suggestions (Phase 2)

## Summary
The replace sheet now offers alternatives before you type: `rankAlternatives` (pure, dependency-free, `src/lib/exercise-alternatives.ts`) scores the picker's already-loaded catalog against the outgoing exercise — shared PRIMARY muscle required (a curl never suggests a row), movement-scale parity bonus (compound↔compound via muscle-breadth proxy), same-category boost, same-equipment penalty (the taken machine), alphabetical tiebreak. The picker renders the top 5 as a "Suggested" rail in replace mode while the query is empty; typing collapses to plain search; add mode and the program builder are untouched. Zero new network requests — the `/api/exercises?all=1` payload already carried muscles/equipment.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Small–Medium | Small–Medium |
| Confidence | 8.5/10 | Single-pass, zero rework |
| Files Changed | 6 | 6 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Ranking tests (RED) | [done] Complete | 11 tests incl. curl-never-suggests-row and determinism |
| 2 | `rankAlternatives` + `isCompound` (GREEN) | [done] Complete | Integer weights 3/2/1/−1, one file to tune |
| 3 | Picker rail | [done] Complete | Widened `ExerciseResult`; rail outside the combobox a11y model |
| 4 | Thread `suggestFor` | [done] Complete | Sheet pass-through; logger supplies it in replace mode only |
| 5 | Full validation | [done] Complete | All levels green |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | tsc + eslint clean |
| Unit Tests | [done] Pass | 11 new (9 ranking, 2 isCompound) |
| Build | [done] Pass | `next build` clean |
| Integration | N/A | Client-only; no API change |
| Edge Cases | [done] Pass | Unknown id / muscle-less current → no rail (Phase-1 fallback); self excluded; dedup in isCompound |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/exercise-alternatives.ts` | CREATED | +71 |
| `src/lib/exercise-alternatives.test.ts` | CREATED | +122 |
| `src/app/workout/new/exercise-picker.tsx` | UPDATED | +52 / -2 |
| `src/app/workout/new/exercise-sheet.tsx` | UPDATED | +10 / -1 |
| `src/app/workout/new/workout-logger.tsx` | UPDATED | +5 |
| `.claude/PRPs/prds/exercise-replacement.prd.md` | UPDATED | phase status |

## Deviations from Plan
None. (The plan was written against the pre-keyboard-fix picker; the rail composed cleanly with the new `fill` layout — it sits in the pinned zone above the scrollable results, exactly where the full-height sheet left space.)

## Issues Encountered
None.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/exercise-alternatives.test.ts` | 11 | primary-muscle requirement, overlap ranking, scale parity, category boost, equipment penalty, self-exclusion, unknown/empty current, count cap + alphabetical determinism, isCompound threshold + dedup |

Full suite: 976 passed (965 pre-existing + 11 new). Rail UI by build + manual per repo convention.

## Manual checklist (needs a device)
- [ ] Replace a machine press → same-muscle presses rank before flyes, no typing
- [ ] Replace a curl → no rows/pulls ever appear
- [ ] Typing hides the rail; clearing restores it
- [ ] "+ Exercise" shows no rail
- [ ] A suggestion tap on a completed exercise still hits the guard dialog

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Phase 3 (substitute targets) — independent, ready to plan
