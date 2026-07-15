# Implementation Report: Exercise Replacement — Substitute Targets (Phase 3)

## Summary
Swapped exercises now carry honest plan targets. `substituteSlot` (pure, `src/lib/substitute-slot.ts`) strips every original-movement absolute from the slot — template `suggestedLoadKg`, override loads, and TM-based progressions (`percent-1rm`, `amrap-cycle`) — while keeping the scheme, rep ranges, RIR/RPE, rest, technique, and rep/rest overrides. `substitutePlanTargetsAction` feeds the sanitized slot into the untouched `deriveDayPrescription` as a one-exercise synthetic day, so the engine's history reads anchor on the SUBSTITUTE (rpe-target yields substitute-scale loads by construction). The logger overlays the result via a `planOverrides` map behind a single `planFor()` lookup used by BOTH ghost placeholders and the rest countdown; the fetch is best-effort and fires from `performReplace` only when a `workoutId` exists.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium (small end) |
| Confidence | 8/10 | Single-pass; one import-path fix |
| Files Changed | 5 | 5 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Sanitizer tests (RED) | [done] Complete | 6 tests pinning the strip/keep table |
| 2 | `substituteSlot` (GREEN) | [done] Complete | `Progression` imports from program-input (not progression) — plan's snippet corrected |
| 3 | `substitutePlanTargetsAction` | [done] Complete | Guards + provenance nulls + loadPlanTargets field-for-field mapping |
| 4 | Logger overlay | [done] Complete | `planFor` choke point; zero direct `planTargets` reads remain outside it |
| 5 | Full validation | [done] Complete | All levels green |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | tsc + eslint clean |
| Unit Tests | [done] Pass | 6 new sanitizer tests |
| Build | [done] Pass | `next build` clean |
| Integration | N/A | Composition rides the already-tested engine (`deriveDayPrescription`) |
| Edge Cases | [done] Pass | Ad-hoc → null; slot-not-found (double-swap) → null; no-history rpe-target → null loads; deep immutability |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/substitute-slot.ts` | CREATED | +47 |
| `src/lib/substitute-slot.test.ts` | CREATED | +133 |
| `src/app/workout/actions.ts` | UPDATED | +55 |
| `src/app/workout/new/workout-logger.tsx` | UPDATED | +28 / -2 |
| `.claude/PRPs/prds/exercise-replacement.prd.md` | UPDATED | phase status |

## Deviations from Plan
- `Progression` is exported from `@/lib/program-input`, not `./progression` (the plan's snippet assumed the latter) — import paths corrected, no behavior change.

## Issues Encountered
None beyond the import path.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/substitute-slot.test.ts` | 6 | re-id, template-load strip (full-row toEqual), override-load strip w/ target survival, TM-scheme drop, keep-schemes passthrough, deep input immutability |

Full suite: 982 passed (976 pre-existing + 6 new).

## Manual checklist (needs a device)
- [ ] Program session swap → empty sets show the slot's rep scheme within a beat; rest countdown keeps the plan's restSec
- [ ] Substitute WITH history → history ghost still wins
- [ ] Substitute WITHOUT history → rep-scheme ghosts, loads only under rpe-target
- [ ] Ad-hoc session swap → no plan ghosts, no errors
- [ ] Undo → original's plan ghosts intact

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Phase 4 (ask-to-remember) — the PRD's final phase, hangs off the same `performReplace`
