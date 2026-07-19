# PR Review: #97 — feat: expose workout notes + skipped over MCP

**Reviewed**: 2026-07-18
**Author**: ddelvalfraire
**Branch**: feat/mcp-notes-skipped → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
MCP surface extension with zero duplicated validation (everything funnels
through parseWorkoutInput/parseNotes; the parseNotes export is visibility-
only). Security checks passed: updateExerciseMeta is ownership-gated via
findOwnedExerciseId inside a transaction; set_exercise_meta is in
COACH_EXCLUDED_TOOLS (enforced by the exhaustive partition test) so the
coach's write surface stays closed while reads flow through the already-
allowed get_workout; null-emitting serialization matches the existing
payload contract.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- update_workout remains full-replace (omitting notes/skipped clears them) —
  documented in the tool description with a pointer to the targeted meta
  tools; consistent with the tool's existing name semantics.
- set_exercise_meta addresses exercises by 0-based position, matching the
  file's existing convention; positions shift if exercises are reordered
  between read and write — same exposure as the other patch tools.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 90 files, 1350 tests (20 new) |
| Build | Pass |

## Files Reviewed
- src/lib/workout-input.ts — parseNotes export (visibility only)
- src/db/workouts.ts(+patch-sets.test) — WorkoutMeta.notes, updateExerciseMeta
- src/lib/mcp/read-tools.ts(+test) — payload fields
- src/lib/mcp/write-tools.ts(+test) — create/update pass-through
- src/lib/mcp/patch-tools.ts(+test) — set_workout_meta notes, new set_exercise_meta
- src/lib/coach/tool-policy.ts — exclusion entry
- src/lib/mcp/tools.test.ts — registry assertion
