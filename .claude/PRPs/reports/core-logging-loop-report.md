# Implementation Report: Core Logging Loop (Phase 3)

## Summary
Built the core value loop: a signed-in user taps **Start Workout** → adds exercises from the Phase 2 wger proxy → logs sets (reps × weight) → **Saves**. The save validates server-side and persists a `workouts` row plus nested `workout_exercises` and `sets` in a single transaction, scoped to the Clerk `userId`. Reads stay in Server Components; the write is a Server Action over a transactional, user-scoped data-access function. Interactive logic (validation, draft reducer, draft→input mapper, save orchestration) is implemented as pure functions and fully unit-tested.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large (as predicted) |
| Files Changed | 13 (10 create, 3 update) | 13 (11 create, 2 update) |
| New runtime deps | 0 | 0 |

Deviation on the file split: the plan listed `src/db/workouts.test.ts` as an UPDATE for the `saveWorkout` test, but per the plan's own GOTCHA/deviation note the test went into a **new** `src/db/save-workout.test.ts` to avoid `vi.mock('./index')` bleeding into the existing `.toSQL()` tests. Net counts match (one fewer update, one more create).

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `workout-input.ts` validation guard | Complete | Hand-rolled `parseWorkoutInput`, mirrors `wger.ts` |
| 2 | `workout-input.test.ts` | Complete | 17 tests |
| 3 | `saveWorkout` transactional insert | Complete | `db.transaction`, user-scoped |
| 4 | `save-workout.test.ts` orchestration test | Complete | New file (deviation) — recording tx stub |
| 5 | `saveWorkoutAction` Server Action | Complete | auth + validate + persist + revalidate |
| 6 | `Input` component | Complete | base-nova wrap of `@base-ui/react/input` |
| 7 | `useDebounce` hook | Complete | |
| 8 | `workout-draft.ts` reducer + mapper | Complete | Pure, immutable |
| 9 | `workout-draft.test.ts` | Complete | 7 tests, referential immutability checks |
| 10 | `exercise-picker.tsx` | Complete | Deviated — see below (set-state-in-effect) |
| 11 | `workout-logger.tsx` | Complete | reducer + `useTransition` + `router.push` |
| 12 | `workout/new/page.tsx` | Complete | Server-component auth gate |
| 13 | Home "Start Workout" entry | Complete | `buttonVariants()` on `<Link>` |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (`tsc --noEmit`) | Pass | Zero type errors |
| Lint (`eslint`) | Pass | Zero errors (after picker effect refactor) |
| Unit Tests (`vitest run`) | Pass | 51 tests across 7 files |
| Build (`next build`) | Pass | Routes include `/workout/new`, `/api/exercises` |
| Live DB round-trip (`tsx`) | Pass | Real `saveWorkout` against Supabase pooler → read back → cascade cleanup |
| Browser e2e (Playwright) | Pass | Live Clerk sign-in → Start → search → log → Save → DB-asserted; user + rows torn down |

### Live verification (post-implementation)

1. **DB transaction on the Supabase pooler** (the top risk) — proven with a real `saveWorkout` round-trip via `tsx`: workout stamped with `userId`, exercise `position` 0..n, set `setNumber` 1..n, `numeric` weight `102.5` preserved exactly, `null` weight preserved, `completed` defaulting false, and cascade delete removing all children. Left no data behind.
2. **Full browser flow** — added a Playwright + `@clerk/testing` harness (`e2e/`, `playwright.config.ts`). A disposable `+clerk_test` user is provisioned via the Clerk Backend API, signed in with the Testing Token (bypasses bot protection) via email/ticket strategy, drives the real UI (Start → search wger → add → log 2 sets → Save), and the persisted tree (1 workout / 1 exercise / 2 sets) is asserted directly in Postgres. Teardown deletes the workout (cascade) and the Clerk user.

**New dev deps added**: `@playwright/test`, `@clerk/testing` (devDependencies), plus `test:e2e` script and `e2e/` gitignore entries.

**Finding (non-blocking)**: the wger catalog upstream response is ~4.7 MB, over Next.js's 2 MB Data-Cache per-item limit, so the `next: { revalidate }` cache on that fetch in `src/lib/wger.ts` is silently a no-op. The in-memory `globalForWger` cache (24 h TTL) still covers it, so behavior is correct — but the HTTP-layer cache is ineffective for that call. Consider dropping the `next.revalidate` option there or chunking the upstream fetch.

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/workout-input.ts` | CREATED | +112 |
| `src/lib/workout-input.test.ts` | CREATED | +130 |
| `src/db/workouts.ts` | UPDATED | +54 / -2 |
| `src/db/save-workout.test.ts` | CREATED | +103 |
| `src/app/workout/actions.ts` | CREATED | +22 |
| `src/components/ui/input.tsx` | CREATED | +21 |
| `src/hooks/use-debounce.ts` | CREATED | +17 |
| `src/app/workout/new/workout-draft.ts` | CREATED | +137 |
| `src/app/workout/new/workout-draft.test.ts` | CREATED | +130 |
| `src/app/workout/new/exercise-picker.tsx` | CREATED | +104 |
| `src/app/workout/new/workout-logger.tsx` | CREATED | +136 |
| `src/app/workout/new/page.tsx` | CREATED | +22 |
| `src/app/page.tsx` | UPDATED | +8 / -4 |

## Deviations from Plan

1. **`saveWorkout` test in a separate file** (`src/db/save-workout.test.ts` rather than appending to `workouts.test.ts`). **Why**: `vi.mock('./index')` would otherwise break the sibling `.toSQL()` tests that need the real query builders. This is exactly the deviation the plan's Task 4 GOTCHA recommended.

2. **Exercise-picker effect restructured to avoid synchronous `setState`.** **Why**: `eslint-plugin-react-hooks@7.1.1` enforces `set-state-in-effect`, which errors on synchronous `setState` in an effect body (cascading renders). All state updates were moved into promise callbacks (`Promise.resolve().then(...)`), and the status/results UI now gates on a derived `isActive` (query ≥ 2 chars) instead of synchronously clearing `results` when the query shrinks. Behavior is unchanged; the cascade warning is gone.

## Issues Encountered
- **Lint error `react-hooks/set-state-in-effect`** in the picker — resolved by the effect refactor above (verified the plugin version and rule intent before fixing). No other issues.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/workout-input.test.ts` | 17 | Validation: valid/normalized, blank-name omit, null reps/weight, no-mutation, and all throw paths |
| `src/db/save-workout.test.ts` | 3 | Tx orchestration: user-scoping, positions, set numbers, linkage, return id, empty-sets skip |
| `src/app/workout/new/workout-draft.test.ts` | 7 | Reducer transitions (add/update/remove, referential immutability) + `draftToInput` coercion |

Total new tests: **27** (suite total 51, all green).

## Next Steps
- [ ] Manual DB verification: save a real workout, confirm `workouts` / `workout_exercises` / `sets` rows with correct `user_id`, `position` (0..n), `set_number` (1..n).
- [ ] Browser walkthrough: `/` → Start Workout → search → add → log → Save → lands on `/`.
- [ ] Code review via `/code-review`.
- [ ] Optional: ship as two commits (3a data/action, 3b UI) to keep diffs ≤300 lines.
