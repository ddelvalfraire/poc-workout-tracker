# Implementation Report: Custom Exercises — Phase 1: Entity + Schema

## Summary
First-class identity model for custom exercises: a per-user `custom_exercises` table (integer identity PK, app-side wger `Exercise` parity), a `source: 'wger' | 'custom'` discriminator (default `'wger'`) on `workout_exercises` and `program_exercises`, CHECK constraints + a migration guard that kill the negative-ID stopgap for good, a Zod input boundary (category locked to wger's 8-category set), and a user-scoped CRUD module (create/update/list, no delete) following the `db/programs.ts` auth-boundary conventions.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium (low friction) |
| Confidence | 9/10 | Held — one test-assertion fix, two fixture touch-ups |
| Files Changed | 8 | 10 (8 planned + 2 test-fixture files) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Input validation module | Done | |
| 2 | Input validation tests | Done | 9 tests |
| 3 | Schema: table + source + CHECKs | Done | Widening `$inferSelect` required adding `source: 'wger'` to fixtures in 2 existing test files |
| 4 | Schema introspection tests | Done | Identity asserted via `generatedIdentity` (drizzle's `generated` is for computed columns) |
| 5 | Migration generate + hand-edit | Done | Deviated — guard placed BEFORE the CHECKs, not appended (see Deviations) |
| 6 | CRUD module | Done | |
| 7 | CRUD tests | Done | 5 tests |
| 8 | Apply migration + validate | Done | Applied clean; DB state verified by query |
| 9 | Update PRD | Done | Phase 1 → complete; 2 open questions checked off |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `tsc --noEmit` clean; changed files lint clean (repo-wide pre-existing lint errors untouched, see Issues) |
| Unit Tests | Pass | 14 new tests; full suite 523/523 across 39 files |
| Build | Pass | `next build` clean |
| Integration | Pass | Migration applied against `DATABASE_URL_DIRECT`; schema verified via information_schema/pg_constraint queries |
| Edge Cases | Pass | Empty/max name, unknown/case-variant category, strict unknown keys, non-owned update → null |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/custom-exercise-input.ts` | CREATED | +62 |
| `src/lib/custom-exercise-input.test.ts` | CREATED | +70 |
| `src/db/schema.ts` | UPDATED | +73 / −11 |
| `src/db/schema.test.ts` | UPDATED | +44 |
| `drizzle/0006_cynical_mephisto.sql` | CREATED (generated + hand-edit) | +31 |
| `drizzle/meta/*` | GENERATED | journal idx 6 + snapshot |
| `src/db/custom-exercises.ts` | CREATED | +76 |
| `src/db/custom-exercises.test.ts` | CREATED | +134 |
| `src/app/programs/new/program-draft.test.ts` | UPDATED | +1 |
| `src/app/workout/new/workout-draft.test.ts` | UPDATED | +2 |
| `.claude/PRPs/prds/custom-exercises.prd.md` | UPDATED | phase status + resolved questions |

## Deviations from Plan
1. **Guard placement in the migration**: the plan said to *append* the `DO` guard block, but appended it would never fire — drizzle-kit's `ADD CONSTRAINT ... CHECK` validates existing rows first and would fail with a generic constraint error. Moved the guard *before* the CHECK statements so its clearer "backfill by hand" message surfaces first. Same intent, corrected ordering.
2. **Identity assertion**: plan suggested `id.generated` truthy; drizzle exposes identity columns as `generatedIdentity` (`generated` is for computed columns). Test asserts `generatedIdentity.type === 'always'`.
3. **Two extra files**: adding the required `source` field to `$inferSelect` widened two detail types, so row fixtures in `program-draft.test.ts` and `workout-draft.test.ts` gained `source: 'wger'` (type-only fixture fix, no behavior change).

## Issues Encountered
- `npm run lint` reports 858 pre-existing repo-wide errors (none in files touched here — verified by linting the changed files directly: clean, exit 0). Left untouched per no-drive-by-refactor scope.
- `db:migrate` printed two Postgres NOTICEs (`drizzle` schema / `__drizzle_migrations` already exist, skipping) — drizzle bookkeeping, harmless.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/custom-exercise-input.test.ts` | 9 | parse/trim, minimal input, all 8 categories, rejections (empty/long name, bad/case-variant category, non-array, strict keys) |
| `src/db/schema.test.ts` (added) | 6 | table name, integer identity, non-null/nullable columns, (user_id,name) unique, source additive on both ref tables, CHECKs present |
| `src/db/custom-exercises.test.ts` | 5 | list returns rows; create stamps owner + null optionals + returns row; update returns row + refreshes updatedAt; non-owned → null |

## Post-Migration DB Verification
- `custom_exercises` exists: integer identity id, text[] parity columns, timestamps — as designed.
- `source` on both ref tables: `NOT NULL DEFAULT 'wger'::text`; all 9 existing `workout_exercises` rows read `'wger'`.
- Both `*_wger_id_positive` CHECK constraints present in `pg_constraint`.

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Phase 2 (composite identity) must wait for the program-stats data layer (`program-stats-data-layer.plan.md`) per the plan's sequencing note; Phase 3 (merged catalog) only depends on this phase
