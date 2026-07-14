# Implementation Report: Program Lifecycle — Block Completion State (Phase 2)

## Summary
The app now knows and says when a block is done. `programWeekState` derives `blockComplete` from the exact reads `nextProgramWeek` has always used (the advancement rule firing AT the final week); `nextProgramWeek` is a byte-compatible thin wrapper. The program page renders a completion card (volt label, top-3 PR deltas via `topPRs`, Stats link) above the day list, and the home hero swaps its Start CTA for a compact "Block complete → See results" banner. Incomplete blocks see zero visual or query-cost change; the final week stays re-runnable.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | High (established patterns only) | High |
| Files Changed | 7 | 7 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Failing week-state tests (RED) | [done] Complete | 4 RED as expected; wrapper regression case passed pre-refactor |
| 2 | `programWeekState` (GREEN) | [done] Complete | Reads byte-for-byte; `NextProgramDay` gains `blockComplete` + `mesocycleWeeks` |
| 3 | `topPRs` tests + helper | [done] Complete | One fixture literal fix: `weight_reps` (not `reps_weight`) |
| 4 | Program page completion card | [done] Complete | Conditional `getProgramStats` fetch only when complete |
| 5 | Home hero completion banner | [done] Complete | Early-return variant; no StartDayButton in it |
| 6 | Full validation | [done] Complete | All levels green |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | `tsc --noEmit` + eslint on all touched files, zero errors |
| Unit Tests | [done] Pass | 9 tests written (5 week-state incl. wrapper regression, 4 topPRs) |
| Build | [done] Pass | `next build` clean |
| Integration | N/A | Read-only server components; no new endpoints |
| Edge Cases | [done] Pass | Empty history, mid-block advance, partial final week, zero-gain card, count cap |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/db/programs.ts` | UPDATED | +51 / -13 |
| `src/db/instantiate-program.test.ts` | UPDATED | +66 / -1 |
| `src/app/programs/[id]/stats/stats-view.ts` | UPDATED | +20 |
| `src/app/programs/[id]/stats/stats-view.test.ts` | UPDATED | +69 / -2 |
| `src/app/programs/[id]/page.tsx` | UPDATED | +76 / -8 |
| `src/app/next-workout-card.tsx` | UPDATED | +35 |
| `.claude/PRPs/prds/program-lifecycle.prd.md` | UPDATED | +4 / -4 |

## Deviations from Plan
- Test fixture `loggingType` used `'weight_reps'` — the plan's sketch implied `'reps_weight'`, which isn't a member of the `LoggingType` union. Cosmetic fixture fix, no behavior impact.

## Issues Encountered
None. Select order preserved; the positional selectQueue harness (26 instantiate tests) passed unchanged.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/db/instantiate-program.test.ts` | 5 | `programWeekState` completion/advance/empty cases + `nextProgramWeek` wrapper regression |
| `src/app/programs/[id]/stats/stats-view.test.ts` | 4 | `topPRs` sort/filter/cap/empty |

Full suite: 944 passed (935 pre-existing + 9 new).

## Decisions Logged
- PRD open question resolved: compact banner on home, full PR-delta card on the program page (checked off in the PRD).
- Accepted edge documented in `programWeekState` JSDoc: manual overshoot past `mesocycleWeeks` computes completion against the overshot week → reads incomplete.

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Phase 3 (Restart-as-clone) — the completion card's action row is its landing spot
