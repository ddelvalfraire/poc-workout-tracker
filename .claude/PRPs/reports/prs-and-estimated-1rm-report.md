# Implementation Report: PRs + Estimated 1RM

## Summary
Added estimated one-rep-max (Epley) calculation and personal-record detection to the
workout detail page. Each exercise now shows an **Est. 1RM** line derived from its best
set, and exercises whose best estimate beats every *earlier* workout earn a **PR** badge.
All 1RM math lives in one pure, unit-tested helper (`src/lib/one-rep-max.ts`); PR detection
uses a single user-scoped history query bounded by `startedAt`.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | High (self-contained) | Confirmed — no scope surprises |
| Files Changed | 7 (2 created, 4 updated, 1 e2e) | 7 (3 created, 4 updated) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Create the 1RM helper (`one-rep-max.ts`) | ✅ Complete | |
| 2 | Unit-test the helper | ✅ Complete | |
| 3 | Add `formatE1RM` formatter | ✅ Complete | |
| 4 | Test `formatE1RM` | ✅ Complete | |
| 5 | Add `getExerciseHistoryBefore` query | ✅ Complete | Empty-id guard + `startedAt < before` time bound |
| 6 | Render Est. 1RM + PR badge on detail page | ✅ Complete | |
| 7 | E2E for the PR flow (`pr.spec.ts`) | ✅ Written | Requires live Clerk+Supabase env; type-checks, not executed here |
| 8 | Mark PRD phase | ✅ Complete | Phase 4 already `in-progress` w/ plan link from planning session |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (`tsc --noEmit`) | ✅ Pass | Zero type errors (covers e2e via `**/*.ts`) |
| Lint (`eslint`) | ✅ Pass | Zero warnings |
| Unit Tests (`npm test`) | ✅ Pass | 123 tests, 16 files (added 12 one-rep-max + 3 formatE1RM) |
| Build (`npm run build`) | ✅ Pass | `/workout/[id]` route compiles |
| E2E (`test:e2e`) | ⏸ Not run | Requires `CLERK_SECRET_KEY` + `DATABASE_URL_DIRECT`; spec written & type-checks |

## Files Changed

| File | Action | Notes |
|---|---|---|
| `src/lib/one-rep-max.ts` | CREATED | `estimate1RM`, `bestSet`, `MAX_RELIABLE_REPS` |
| `src/lib/one-rep-max.test.ts` | CREATED | 12 unit tests |
| `e2e/pr.spec.ts` | CREATED | PR-badge flow E2E |
| `src/lib/format.ts` | UPDATED | Added `formatE1RM(e1rmKg, unit)` |
| `src/lib/format.test.ts` | UPDATED | 3 `formatE1RM` cases |
| `src/db/workouts.ts` | UPDATED | Added `getExerciseHistoryBefore`; imports `inArray`, `lt` |
| `src/app/workout/[id]/page.tsx` | UPDATED | History load + per-exercise best/PR compute + render |

## Deviations from Plan
- **`bestSet` exact-value test**: the plan suggested asserting `e1rm: 121` exactly for
  `3 × 110`. Epley yields `121.00000000000001` (float), so the assertion uses `toBeCloseTo`
  for `e1rm` while keeping exact `toBe` for `reps`/`weightKg`. The implementation keeps full
  precision intentionally (rounding only at display), so the test was adjusted, not the code.

## Issues Encountered
- One unit-test float mismatch (above) — resolved by switching the affected assertion to
  `toBeCloseTo`. No implementation change.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/one-rep-max.test.ts` | 12 | `estimate1RM` (single/Epley/null/zero/non-finite), `bestSet` (max/empty/blank/ties) |
| `src/lib/format.test.ts` (added) | 3 | `formatE1RM` kg identity, default unit, lb rounding |

## Next Steps
- [ ] Run `npm run test:e2e` in an environment with live Clerk + Supabase secrets to exercise `pr.spec.ts`
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
