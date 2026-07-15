# Implementation Report: Exercise Stats — Phase 3: Logger Sheet

## Summary
The exercise name in the logger now opens a bottom sheet with all-time records, the last three sessions, and a link to `/exercises/wger/[id]`. One read-only server action (`getExerciseSheetAction`) feeds it in a single round trip, cached per exercise via TanStack Query. Dialog recipe shared with the other sheets; cleared at save/discard and (new) at async draft restore.

## Assessment vs Reality
| Metric | Predicted | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Files | 4 | 4 |

## Tasks
All 5 plan tasks complete. Review: 1 MEDIUM (restore-race sheet staleness — fixed for BOTH stats and plate sheets), 1 LOW fixed (tap target), 1 LOW accepted. See `.claude/PRPs/reviews/exercise-stats-logger-sheet-review.md`.

## Validation
Tests 68 files / 1014 (3 new action tests); lint clean; build green; PR #58.

## Deviations from Plan
- Review surfaced that the plan's "clear at both navigation sites" was necessary but not sufficient — the async `RESTORE_DRAFT` effect was the reachable staleness window; fixed there for both index-addressed sheets.

## Next Steps
- [x] Merged via PR #58
- [ ] Phase 4 (PR detection) — the last phase
