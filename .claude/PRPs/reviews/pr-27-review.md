# PR Review: #27 — feat: bodyweight logging types with rep-based top-set fallback

**Reviewed**: 2026-07-08
**Author**: ddelvalfraire
**Branch**: feat/bodyweight-logging-types → main
**Decision**: APPROVE (both MEDIUM findings fixed in f572d74)

## Summary
Core scoring math (effectiveLoadKg/bestScoredSet), validation boundaries, authz, migration additivity, and draft-codec compatibility all verified sound with substantial test coverage (~90 new tests). Two real behavioral gaps found and fixed in-branch.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
- **[FIXED]** Switching an exercise's logging type mid-session silently re-interpreted already-typed weights under the new meaning (100 total load → +100 added on top of bodyweight → inflated e1RM, phantom PR). `SET_LOGGING_TYPE` now clears the exercise's typed weights; reps/completion survive. Tests updated.
- **[FIXED]** `deriveDayPrescription` fed raw history weights to `bestSet` regardless of logging type, so a weighted-BW row's added load deflated program load prescriptions. `getExerciseHistoryBefore` now returns each row's `loggingType` and prescriptions admit only `weight_reps` rows. New test.

### LOW
- `formatSet`'s BW branch uses dense nested ternaries — correct per tests, style-only. Accepted.
- History rows for PR badges are scored under the exercise's *current* logging type (rows carry no type of their own at the badge-comparison layer); mixed-kind comparisons never badge. Deliberate, documented in code.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass (734) |
| Build | Pass |

## Files Reviewed
28 files (+2083/−89): scoring (one-rep-max.ts), validation (workout-input.ts), schema + migration drizzle/0009 (additive: two nullable/defaulted columns), persistence (db/workouts.ts, db/preferences.ts), actions.ts, draft layer (workout-draft.ts, draft-payload.ts), logger UI (workout-logger.tsx), summary page (workout/[id]/page.tsx), format.ts, bodyweight-editor.tsx, MCP read-tools.ts/resources.ts, tests.

## Deploy note
Apply `drizzle/0009_messy_jubilee.sql` (`npm run db:migrate`) before/with deploy.
