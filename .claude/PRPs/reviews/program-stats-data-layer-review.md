# Local Review: Program Stats — Data Layer (pre-PR)

**Reviewed**: 2026-07-10
**Branch**: feat/program-stats-data-layer (uncommitted: 2 new src files)
**Decision**: FIX MEDIUM BEFORE PR (no CRITICAL/HIGH)
**Resolution (same day)**: all three findings fixed, TDD for M1/L1 (2 new failing-first tests); suite 881/881, tsc/lint/build clean.

## Summary
The module is correct against its plan and the plan's full test matrix passes, but the plan itself carried an identity gap the schema explicitly warns about: exercise identity is the composite `(source, id)` (`src/db/schema.ts:51-52`), and the progression grouping keys by the numeric id alone.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1 — Progression merges a custom and a wger exercise that share a numeric id.**
`src/db/program-stats.ts` (`aggregateExercises`, keyed on `row.wgerExerciseId`; the flat-rows select omits `workoutExercises.source`). `custom_exercises.id` is `generatedAlwaysAsIdentity()` starting at 1, and wger ids are also small integers, so a program containing custom exercise #3 and wger exercise #3 would produce ONE merged progression series — mixed e1RM trend under whichever name occurred last. Silent wrong data.
- Why it matters now: `ProgramExerciseProgression`'s key shape is the API for Phases 2–4; changing it after the UI/MCP consume it is a breaking change. The fix is small today: select `source`, group by `` `${source}:${id}` ``, expose `source` on the progression.
- Note: `getLastPerformance` has the same pre-existing gap (out of scope here; the broader source-discriminator pass is already deferred post-stats by decision).

### LOW

**L1 — `firstIndex` not refreshed when a later row lowers `firstWeek`.** In `aggregateExercises`, if rows ever arrive week-out-of-order (startedAt ordering doesn't strictly guarantee week order), an exercise's sort key becomes (earlier week, later index). Ordering stays deterministic; at worst two exercises tied on week sort by discovery index rather than in-week appearance. Cosmetic.

**L2 — `rows as ProgramStatsRow[]` cast.** The inner join guarantees `programDayId` non-null but the schema type says nullable; the cast is commented. Acceptable; a `.filter` would trade a cast for a runtime no-op.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (new files) | Pass |
| Tests | Pass — 879/879 (13 new) |
| Build (`next build`) | Pass |

## Files Reviewed
- `src/db/program-stats.ts` — Added
- `src/db/program-stats.test.ts` — Added
