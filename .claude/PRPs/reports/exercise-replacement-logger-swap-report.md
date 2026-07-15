# Implementation Report: Exercise Replacement — Logger Swap (Phase 1)

## Summary
The machine-is-taken moment is solved: every exercise card in the logger has a ⇄ Replace button (all logging types, in the utility cluster before the trash hairline) that opens the existing `ExerciseSheet` retitled "Replace {name}". Picking a substitute swaps identity in place — set COUNT kept, values/completion/loggingType reset (the meaning-change rule) — with history ghosts re-pointing automatically via `wgerExerciseId`. An exercise with logged sets pauses at a new `ReplaceConfirmDialog` ("partially/fully completed") offering **Add instead** (safe default focus) vs **Replace** (destructive), Esc/backdrop cancelling clean. Every swap is undoable from the existing 5s undo stack, restoring the original with its logged values.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | 8/10 | Single-pass, zero rework |
| Files Changed | 5 | 5 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Reducer + factory tests (RED) | [done] Complete | 4 RED (verbatim-replace + 3 factory) |
| 2 | `REPLACE_EXERCISE` + `replacementDraftExercise` (GREEN) | [done] Complete | Stale-index no-op guard; reducer stays pure |
| 3 | `ExerciseSheet` heading prop | [done] Complete | + `min-w-0 truncate` on the label (long names) |
| 4 | `ReplaceConfirmDialog` | [done] Complete | ConfirmDialog mechanics copied; Add-instead holds focus |
| 5 | Logger wiring | [done] Complete | Button, dual-mode sheet, guard, undo branch, toast verbs |
| 6 | Full validation | [done] Complete | All levels green |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | tsc + eslint on src/app/workout/new |
| Unit Tests | [done] Pass | 5 new (2 reducer, 3 factory) |
| Build | [done] Pass | `next build` clean |
| Integration | N/A | Client-only; draft autosave path unchanged |
| Edge Cases | [done] Pass | Stale index no-op; vanished-target guards; zero-completed → no dialog |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/app/workout/new/workout-draft.ts` | UPDATED | +32 |
| `src/app/workout/new/workout-draft.test.ts` | UPDATED | +78 |
| `src/app/workout/new/exercise-sheet.tsx` | UPDATED | +6 / -3 |
| `src/app/workout/new/replace-confirm-dialog.tsx` | CREATED | +117 |
| `src/app/workout/new/workout-logger.tsx` | UPDATED | +105 / -14 |

## Deviations from Plan
- Added `min-w-0 truncate` to the sheet's heading label — "Replace {long name}" can overflow the sheet header; cosmetic, in the spirit of the plan's 320px risk note.

## Issues Encountered
None.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/app/workout/new/workout-draft.test.ts` | 5 | REPLACE_EXERCISE verbatim swap + sibling/immutability, stale-index no-op; factory set-count/floor/identity-reset |

Full suite: 965 passed (960 pre-existing + 5 new). UI surfaces (button, sheet mode, guard dialog, undo) covered by build + manual per repo convention.

## Manual checklist (needs a device)
- [ ] Program day: ⇄ → swap → set count kept, inputs empty, ghosts show substitute history
- [ ] Undo restores the original with logged values
- [ ] Completed sets → guard; Add instead appends; Esc cancels
- [ ] Swap survives reload (draft round-trip); freestyle sessions identical
- [ ] 320px header doesn't overflow

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Phase 2 (suggestions rail) and Phase 3 (substitute targets) can run in parallel
