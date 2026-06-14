# Implementation Report: Edit & Delete (Phase 5)

## Summary
Added edit and delete flows for saved workouts. The read-only detail page (`/workout/[id]`) now hosts a client `WorkoutActions` island with an **Edit** link and a **Delete** button. A new `/workout/[id]/edit` route re-uses the existing `WorkoutLogger` (seeded from the saved workout via a pure `detailToDraft` mapper) to mutate sets/exercises; saving calls a user-scoped, transactional `updateWorkout` that atomically replaces the workout's children. Delete is a user-scoped cascade. Both writes go through the `src/db/workouts.ts` authorization boundary and `revalidatePath` the affected routes; the client navigates after the round-trip (no server `redirect()` inside a caught action).

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium–Large | Medium — implemented as planned, no surprises |
| Confidence | High (established internal patterns) | Confirmed — all auto-verifiable validation green |
| Files Changed | 11 (3 create, 7 update, 1 e2e) | 11 (4 create incl. e2e, 7 update) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `deleteWorkout`/`updateWorkout` + extract `insertWorkoutChildren` (`src/db/workouts.ts`) | Complete | `Tx` type lifted via `Parameters<…>`; `saveWorkout` refactored to call the shared helper |
| 2 | `deleteWorkout` `.toSQL()` user-scoping test | Complete | |
| 3 | `update-workout.test.ts` (recording-stub) | Complete | Covers happy path, name→null, not-owned → null with no delete/insert |
| 4 | `updateWorkoutAction`/`deleteWorkoutAction` (`actions.ts`) | Complete | Returns void / throws on not-owned; no server redirect |
| 5 | `detailToDraft` pure mapper (`workout-draft.ts`) | Complete | Type-only `WorkoutDetail` import; reuses persisted UUIDs |
| 6 | `detailToDraft` unit tests | Complete | numbers→strings, null→'', name fallback, ids reused |
| 7 | Parameterize `WorkoutLogger` (edit mode) | Complete | Conditional category segment; "Save changes" label |
| 8 | `WorkoutActions` client island | Complete | Edit `<Link>` + destructive Delete with confirm + inline error |
| 9 | Wire `<WorkoutActions>` into detail page | Complete | Page stays a Server Component |
| 10 | Edit page (`[id]/edit/page.tsx`) | Complete | `notFound()` on unowned/unknown id; Cancel → detail |
| 11 | `edit-delete.spec.ts` (live-env e2e) | Complete | Executed against live Clerk + Supabase — passed (15.7s) |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (`tsc --noEmit`) | Pass | Zero type errors |
| Lint (`eslint`) | Pass | Clean |
| Unit Tests (`vitest run`) | Pass | 68 tests / 9 files; new: `update-workout.test.ts` (3), `deleteWorkout` `.toSQL()` (1), `detailToDraft` (2); `save-workout.test.ts` still green after the helper extraction |
| Build (`next build`) | Pass | Route list includes `/workout/[id]/edit` |
| E2E (`playwright test`) | Pass | 3/3 passed against live Clerk + Supabase: new `edit-delete.spec.ts` (15.7s) + existing `workout.spec.ts` (no regression) |
| Manual browser/DB | Covered by e2e | The e2e drives the real browser: create → edit Set 1 weight to 105 (asserted `= 105` in Postgres) → delete (asserted `count(*) = 0`, confirming cascade). Not-found path is covered by the user-scoped unit tests + the identical detail-page pattern |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/db/workouts.ts` | UPDATED | +89 / -31 |
| `src/db/workouts.test.ts` | UPDATED | +7 |
| `src/db/update-workout.test.ts` | CREATED | +99 |
| `src/app/workout/actions.ts` | UPDATED | +28 / -1 |
| `src/app/workout/new/workout-draft.ts` | UPDATED | +23 |
| `src/app/workout/new/workout-draft.test.ts` | UPDATED | +47 |
| `src/app/workout/new/workout-logger.tsx` | UPDATED | +35 / -10 |
| `src/app/workout/[id]/workout-actions.tsx` | CREATED | +49 |
| `src/app/workout/[id]/page.tsx` | UPDATED | +3 |
| `src/app/workout/[id]/edit/page.tsx` | CREATED | +36 |
| `e2e/edit-delete.spec.ts` | CREATED | +113 |

## Deviations from Plan
None — implemented exactly as planned. The `Tx` type extraction worked under the project's TypeScript version, so the documented inline-duplication fallback was not needed.

## Issues Encountered
None blocking. A repository "fact-forcing gate" required pre-edit facts (importers, affected exports, data shape) before each create/edit; these were supplied each time and did not change the implementation.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/db/update-workout.test.ts` | 3 | `updateWorkout` control flow: ownership gate → clear → ordered re-insert; name→null; not-owned → null (no mutation) |
| `src/db/workouts.test.ts` (added) | 1 | `deleteWorkout` user+id scoping via `.toSQL()` |
| `src/app/workout/new/workout-draft.test.ts` (added) | 2 | `detailToDraft` mapping + empty-name fallback |
| `e2e/edit-delete.spec.ts` | 1 | Live edit-a-set + delete round-trip with Postgres assertions (run manually) |

## Next Steps
- [x] Run `npm run test:e2e` against a live Clerk + Supabase env — 3/3 passed
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr` (suggested commit split in the plan: Delete → Edit → E2E)
