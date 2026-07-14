# Implementation Report: Program Lifecycle — Restart-as-Clone (Phase 3)

## Summary
One tap rolls a block over. `cloneProgram` (db layer) copies the entire program tree row-for-row — days, exercises (supersetGroup, custom-exercise `source`, progression), sets (all columns incl. technique/restSec), per-week set overrides remapped to the new set ids, and muscle tags copied verbatim (no catalog fetch) — as a fresh draft named by `nextBlockName` ("PPL" → "PPL — Block 2"). `restartProgramAction` clones then activates; the existing single-active sweep archives an active source. One shared `RestartProgramButton` island (outline, affirmative volt confirm via the new `confirmVariant` prop) renders in the completion card's action row and in ProgramActions for active/archived programs — never drafts.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium (large end) | Medium |
| Confidence | 8/10 | Implemented single-pass, zero rework |
| Files Changed | 10 | 10 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `nextBlockName` (RED→GREEN) | [done] Complete | 5 tests incl. end-anchor + length clamp |
| 2 | Clone fidelity tests (RED) | [done] Complete | Maximal fixture: supersets, custom source, technique, 2 overrides, muscles, 2 days |
| 3 | `cloneProgram` (GREEN) | [done] Complete | Row copy in one tx; VALUES-order returning zip for override remap |
| 4 | `restartProgramAction` | [done] Complete | clone → activate; sweep does the archiving |
| 5 | `ConfirmDialog` `confirmVariant` | [done] Complete | Optional, defaults 'destructive' — existing callers untouched |
| 6 | `RestartProgramButton` island | [done] Complete | closeRef-before-navigate (#25), in-dialog error retry |
| 7 | Entry points | [done] Complete | Completion card action row + ProgramActions (status ≠ draft) |
| 8 | Full validation | [done] Complete | All levels green |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | tsc + eslint on all touched files |
| Unit Tests | [done] Pass | 10 new (5 block-name, 5 clone fidelity) |
| Build | [done] Pass | `next build` clean |
| Integration | N/A | Server action exercised through the db layer per repo convention |
| Edge Cases | [done] Pass | Not-owned → null/no inserts; empty override/muscle sets → no empty inserts; archived source restart |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/block-name.ts` | CREATED | +21 |
| `src/lib/block-name.test.ts` | CREATED | +30 |
| `src/db/clone-program.test.ts` | CREATED | +310 |
| `src/db/programs.ts` | UPDATED | +118 |
| `src/app/programs/actions.ts` | UPDATED | +25 |
| `src/components/confirm-dialog.tsx` | UPDATED | +8 / -3 |
| `src/app/programs/[id]/restart-program-button.tsx` | CREATED | +90 |
| `src/app/programs/[id]/program-actions.tsx` | UPDATED | +5 |
| `src/app/programs/[id]/page.tsx` | UPDATED | +13 / -8 |
| `.claude/PRPs/prds/program-lifecycle.prd.md` | UPDATED | phase status |

## Deviations from Plan
None in implementation. The plan itself deviated from the PRD's `cloneProgramInput(detail)` sketch (row-copy clone instead of a ProgramInput round-trip) — decided and documented at planning time because the input schema cannot express supersetGroup/source/overrides.

## Issues Encountered
None.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/block-name.test.ts` | 5 | plain stamp, increment, multi-digit, inner-em-dash safety, length clamp |
| `src/db/clone-program.test.ts` | 5 | draft+derived name, superset/custom/override/muscle fidelity, full set columns + positions + write count, ownership gate, no catalog call |

Full suite: 955 passed (945 pre-existing + 10 new).

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Phase 4: MCP `restart_program` wrapping `cloneProgram` + `setProgramStatus`
