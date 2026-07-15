# Implementation Report: Exercise Replacement — Ask-to-Remember (Phase 4)

## Summary
The PRD's final phase. After swapping a PLAN exercise, a quiet `role="status"` row in the sticky bar asks "Use {substitute} for the rest of the block?" — **Use for block** persists via `rememberSwapAction`, which resolves position addresses AT ACCEPT TIME from the workout's provenance and applies the override-safe `updateProgramExercise` patch (sets + per-week overrides untouched, muscles re-tagged), then revalidates the program surfaces. **Just today** snoozes that exercise in-memory for the rest of the workout — a fresh swap next session re-asks once, the PRD's decided anti-nag design. The prompt never renders for freestyle sessions, hand-added exercises, or re-swapped substitutes (the gate reads the server-seeded `planTargets`, never the overlay), and dies with undo, save/discard, or a draft restore per the logger's reset conventions.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Small–Medium | Small–Medium |
| Confidence | 8.5/10 | Single-pass, zero rework |
| Files Changed | 3 | 3 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `rememberSwapAction` | [done] Complete | Guards → provenance resolution → position-addressed patch → throw-on-broken-link → revalidate |
| 2 | Prompt state + wiring | [done] Complete | performReplace gate; undo withdraws by replacementId; all three reset sites extended |
| 3 | Prompt row UI | [done] Complete | Above the undo toast; ghost/outline pair; error renders in-row |
| 4 | Full validation | [done] Complete | All levels green |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | tsc + eslint clean |
| Unit Tests | [done] Pass | None new (no new pure seam — documented plan decision); 982 all green |
| Build | [done] Pass | `next build` clean |
| Integration | N/A | Action is thin composition over the tested `updateProgramExercise` |
| Edge Cases | [done] Pass | Freestyle/hand-added/double-swap never prompt; snooze honored; undo/save/discard/restore all clear the prompt |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/app/workout/actions.ts` | UPDATED | +45 |
| `src/app/workout/new/workout-logger.tsx` | UPDATED | +105 |
| `.claude/PRPs/prds/exercise-replacement.prd.md` | UPDATED | phase + PRD status |

## Deviations from Plan
None.

## Issues Encountered
None.

## Tests Written
None new — documented plan decision: no new pure seam (the action composes the already-tested `updateProgramExercise`; UI follows the repo's build+manual convention).

## Manual checklist (needs a device)
- [ ] Swap a plan exercise → prompt appears; "Use for block" → program page shows the substitute with the original's sets and per-week overrides intact
- [ ] "Just today" → same exercise swapped again this session → no re-prompt
- [ ] Undo right after swapping → prompt withdrawn with the swap
- [ ] Freestyle session swap → no prompt
- [ ] Accept offline → error in the row; retry succeeds after reconnect
- [ ] 320px: prompt + undo toast stack cleanly

## PRD Status
**The exercise-replacement PRD is complete** — all four phases shipped: logger swap, muscle-matched suggestions, substitute targets, ask-to-remember. Remaining success metrics (used-in-anger weekly, no stats corruption) are field-testing items.

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`, merge, deploy
