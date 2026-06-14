# Implementation Report: History & Detail (Phase 4)

## Summary
Delivered the "review past workouts" half of the app. The home page (`/`) now renders a
user-scoped history list (each session with its date and exercise/set counts), and a new
`/workout/[id]` route renders a read-only session detail (exercises in order, each set's
reps × weight). Both reads are Server Components that go through the user-scoped data-access
layer in `src/db/workouts.ts`. No new write paths, no client components, no new dependencies.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | High (self-contained) | Confirmed — implemented exactly as planned |
| Files Changed | 6 (3 create, 3 update) | 6 (3 create, 3 update) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | History + detail queries (`src/db/workouts.ts`) | ✅ Complete | `listWorkoutSummaries` (aggregate join) + `getWorkoutDetail` (relational) + `WorkoutSummary`/`WorkoutDetail` types |
| 2 | Query user-scoping tests (`src/db/workouts.test.ts`) | ✅ Complete | Two `.toSQL()` tests added; existing three intact |
| 3 | Display helpers (`src/lib/format.ts`) | ✅ Complete | Pure `formatWorkoutDate`, `formatSet` |
| 4 | Helper tests (`src/lib/format.test.ts`) | ✅ Complete | 6 tests (all null/partial combos + year assertion) |
| 5 | History list on home (`src/app/page.tsx`) | ✅ Complete | Placeholder replaced; empty-state + linked cards |
| 6 | Detail page (`src/app/workout/[id]/page.tsx`) | ✅ Complete | `notFound()` on missing/not-owned; read-only cards |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (tsc) | ✅ Pass | Zero type errors |
| Lint (eslint) | ✅ Pass | No errors, no `console.log` |
| Unit Tests | ✅ Pass | 63 tests across 8 files (7 new this phase) |
| Build (next build) | ✅ Pass | Route list includes `/` and `/workout/[id]` |
| Integration | N/A | Requires Clerk auth + live Supabase; manual browser/DB steps documented in plan |
| Edge Cases | ✅ Pass | Covered by unit tests (null reps/weight, fractional, empty) + plan checklist |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/db/workouts.ts` | UPDATED | +44 |
| `src/db/workouts.test.ts` | UPDATED | +19 / -1 |
| `src/lib/format.ts` | CREATED | +18 |
| `src/lib/format.test.ts` | CREATED | +35 |
| `src/app/page.tsx` | UPDATED | +43 / -5 |
| `src/app/workout/[id]/page.tsx` | CREATED | +58 |

## Deviations from Plan
None — implemented exactly as planned.

## Issues Encountered
- A repository "Fact-Forcing Gate" hook intercepted each file write/edit, requiring impact
  facts (importers, affected exports, data shapes, instruction quote) before proceeding.
  Facts were supplied for each and the operations retried successfully. No code impact.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/db/workouts.test.ts` | +2 | `listWorkoutSummaries`/`getWorkoutDetail` user-scoping via `.toSQL()` |
| `src/lib/format.test.ts` | 6 | `formatSet` (all null/partial/fractional combos), `formatWorkoutDate` (year) |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Manual browser validation (signed-in): save → appears in History → tap → detail; foreign UUID 404s
- [ ] Create PR via `/prp-pr`
- [ ] Phase 5 (Edit & delete) — detail page is the natural host for those controls
