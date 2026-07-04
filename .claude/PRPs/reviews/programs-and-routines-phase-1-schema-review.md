# Code Review: Programs & Routines — Phase 1 (Schema + Zod + Metric Model)

**Reviewed**: 2026-06-28
**Branch**: feat/programs-phase-1-schema (local, uncommitted)
**Mode**: Local Review
**Decision**: APPROVE with comments

## Summary
The Phase 1 schema/Zod/DB-ops foundation faithfully mirrors the existing workout tree. An independent `code-reviewer` pass confirmed all five core invariants hold (userId scoping as the authz boundary, `program_day_id` ON DELETE SET NULL vs CASCADE in the program tree, canonical-kg with no conversion in this layer, additive/defaulted metric columns on live `sets`, immutable Zod parse with correctly-typed narrow JSONB). No CRITICAL or HIGH issues. One actionable MEDIUM fixed during review; the rest are deferred-by-design or intentional parity.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
1. **`deloadWeek` could exceed `mesocycleWeeks`** — `src/lib/program-input.ts`. A logically invalid deload week passed validation and would persist silently. **FIXED**: added a cross-field `.refine()` (`deloadWeek <= mesocycleWeeks`) + two tests (accept-within / reject-over).
2. **`workouts`↔`programDays` Drizzle `relations()` not cross-wired** — `src/db/schema.ts`. **Deferred by design (not a defect).** The plan's "NOT Building" list explicitly excluded the `workouts.programDay` relation as YAGNI: nothing in Phase 1 reads it, and Phase 3's `get_workout` plan overlay can use explicit joins (as `getLastPerformance` already does) rather than the relational `with:` API — so it is not a hard blocker. Will be added in Phase 3 when first consumed.

### LOW
1. **Dead `if (exercise.sets.length > 0)` guard** in `insertProgramChildren` (`src/db/programs.ts`). Intentional 1:1 mirror of `insertWorkoutChildren`; kept for pattern parity. (`programExerciseSchema` enforces `sets.min(1)`, so it is technically unreachable post-validation.)
2. **No FK-column indexes** on `program_days.program_id` / `program_exercises.program_day_id` / `program_sets.program_exercise_id` (`drizzle/0003_absurd_wasp.sql`). The existing workout tree also indexes only `user_id`; kept for parity and to avoid a drive-by. Fine at single-user POC scale; revisit before write volume grows.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint src` + changed files) | Pass |
| Tests (`vitest run --exclude worktrees`) | Pass (274 + 2 new = 276) |
| Build (`next build`) | Pass |
| Migration applied + verified | Pass (4 tables, new cols, `program_sets` unique DEFERRABLE confirmed via pg_constraint) |

## Files Reviewed
- `src/lib/program-input.ts` — Added (Zod boundary; deloadWeek refine added in review)
- `src/db/programs.ts` — Added (user-scoped ops)
- `src/db/schema.ts` — Modified (4 program tables, metric cols on `sets`, provenance on `workouts`)
- `drizzle/0003_absurd_wasp.sql` — Added (migration; hand-edited DEFERRABLE)
- `src/lib/program-input.test.ts` — Added (24 tests)
- `src/db/save-program.test.ts` — Added (3 tests)
- `src/db/schema.test.ts` — Modified (+4 introspection assertions)
- `src/app/workout/new/workout-draft.test.ts` — Modified (fixture completion for widened type)
- `drizzle/meta/*` — Generated (not reviewed in depth)
