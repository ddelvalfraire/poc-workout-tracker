# Implementation Report: Programs & Routines — Phase 1 (Schema + Zod + Metric Model)

## Summary
Implemented the data foundation for first-class training Programs: the Zod validation boundary (`src/lib/program-input.ts`), the `programs → program_days → program_exercises → program_sets` Drizzle hierarchy with a narrow JSONB tail (`technique`, `progression`), the timed-exercise metric model (`metric_mode`/`duration_sec`/`distance_m`) added to both `program_sets` and the live `sets` table, provenance columns (`program_day_id`/`program_week`) on `workouts`, user-scoped DB ops (`src/db/programs.ts`), and one generated + hand-edited migration. No MCP tools or UI — those are Phases 2–6.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | 8/10 | Implemented single-pass; only fallout was completing existing `WorkoutDetail` test fixtures |
| Files Changed | 4 new + 1 migration + 2 edited | 4 new + 1 migration + 3 edited (one extra test-fixture file) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Zod contract `program-input.ts` | Complete | Used chained `.refine()` (not `.superRefine()`) for Zod-4 version-stability — see Deviations |
| 2 | Extend `schema.ts` | Complete | + 4 tables/relations, 3 `sets` cols, 2 `workouts` cols. Required completing 3 `WorkoutDetail` fixtures in an existing test |
| 3 | DB ops `programs.ts` | Complete | `list`/`getDetail`/`save`/`update`/`delete`/`setStatus`, mirroring `workouts.ts` |
| 4 | Migration `0003_absurd_wasp.sql` | Complete | Generated; hand-edited `program_sets` unique → `DEFERRABLE INITIALLY DEFERRED`. NOT applied (manual step) |
| 5 | `program-input.test.ts` | Complete | 22 tests |
| 6 | `save-program.test.ts` | Complete | 3 tests (recording-stub transaction) |
| 7 | Extend `schema.test.ts` | Complete | + 4 introspection assertions |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `tsc --noEmit` clean; `eslint src` clean (changed files clean) |
| Unit Tests | Pass | 274 tests pass (excl. stray worktree); 25 new + 4 extended |
| Build | Pass | `next build` succeeds; route table unchanged |
| Integration | N/A | No new runtime endpoints/pages this phase |
| Edge Cases | Pass | empty days/exercises/sets, bad enums, timed-without-duration, repMin>repMax, load over ceiling, unknown technique/progression |

## Files Changed

| File | Action | Lines (approx) |
|---|---|---|
| `src/lib/program-input.ts` | CREATED | +160 |
| `src/db/programs.ts` | CREATED | +185 |
| `src/lib/program-input.test.ts` | CREATED | +270 |
| `src/db/save-program.test.ts` | CREATED | +175 |
| `drizzle/0003_absurd_wasp.sql` | CREATED (gen + hand-edit) | +63 |
| `src/db/schema.ts` | UPDATED | +120 / -2 |
| `src/db/schema.test.ts` | UPDATED | +37 / -3 |
| `src/app/workout/new/workout-draft.test.ts` | UPDATED | +9 / -3 (fixture completion) |

## Deviations from Plan

1. **`.refine()` instead of `.superRefine()`** (Task 1). The plan's contract sketched a `.superRefine`. I used two chained `.refine()` calls (timed-set-needs-duration; repMin≤repMax) — equivalent behavior, but stable across Zod 4 where `superRefine` is deprecated. No change to validation semantics; both rules are tested.
2. **One extra edited file** (`workout-draft.test.ts`, Task 2). Adding the additive `metric_mode`/`duration_sec`/`distance_m` columns to `sets` and `program_day_id`/`program_week` to `workouts` widened the inferred `WorkoutDetail` type, so three existing synthetic fixtures needed the new fields. This is required fallout from an additive schema change, not a refactor.

## Issues Encountered

1. **Test/lint pollution from a stray git worktree.** `.claude/worktrees/feat+unit-preference-kg-lb/` (an untracked checkout of another branch) is discovered by Vitest and ESLint, producing 9 failing test files and ~17.9k lint problems that have nothing to do with this phase. Verified the real repo is clean: `vitest run --exclude '**/.claude/worktrees/**'` → 274 pass; `eslint src` → clean. Pre-existing repo-hygiene issue; out of scope here.
2. **Migration not applied.** Per plan, `0003_absurd_wasp.sql` was generated and hand-edited but NOT applied — `npm run db:migrate` (DDL via `DATABASE_URL_DIRECT`/5432) touches the live dev DB and is left for the user to run.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/program-input.test.ts` | 22 | Zod boundary: defaults, trimming, typed targets, technique/progression accept, all reject cases |
| `src/db/save-program.test.ts` | 3 | Transactional insert order/linkage, 0-based positions, typed-target/progression/technique passthrough |
| `src/db/schema.test.ts` | +4 | Program table names; additive metric cols on `sets`; nullable provenance on `workouts`; `program_sets` defaults |

## Next Steps
- [ ] **Apply the migration**: review `drizzle/0003_absurd_wasp.sql`, then `npm run db:migrate`
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Proceed to **Phase 2** (MCP coarse authoring + read) — wraps `db/programs.ts`
