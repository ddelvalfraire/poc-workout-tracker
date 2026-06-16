# Local Review: Repeat Last Workout

**Reviewed**: 2026-06-15
**Branch**: feat/last-time-inline
**Decision**: APPROVE

## Summary
A focused, well-tested feature: a "Repeat workout" entry point on both the home history row and the workout detail page deep-links to `/workout/new?from=<id>`, which seeds the logger with the source workout's exercises and sets. Ownership is correctly enforced, input is validated, and the new mapper is unit-tested. No security, correctness, or quality blockers found.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW
- **`searchParams` type vs. runtime shape** — `src/app/workout/new/page.tsx:18` types `from?: string`, but a duplicated query param (`?from=a&from=b`) yields `string[]` at runtime in Next.js. This is handled safely (the array stringifies and fails `UUID_RE`, falling back to a blank logger), so it is harmless — noting only for type accuracy.
- **Seeded `category` is empty** — `detailToDraft` sets `category: ''` (not a persisted column), so the exercise subtitle is absent when repeating. Cosmetic and already documented in the helper's JSDoc.

## Positive Notes
- **No IDOR**: `getWorkoutDetail(userId, id)` is scoped to the Clerk `userId` (`src/db/workouts.ts:95`), so `?from=<another user's id>` returns `undefined` and renders a blank logger.
- **Input validation**: `UUID_RE` guards the `?from` value before it reaches the Postgres `uuid` column, preventing an `invalid input syntax for type uuid` 500. Rationale captured in a comment.
- **Parallel fetch**: unit preference and source workout load via `Promise.all`, avoiding a waterfall.
- **Unit correctness**: stored canonical kg is converted to the user's current display unit when seeding; round-trips back to kg at save time.
- **Reused row UUIDs as React keys only** — never persisted by `draftToInput`, so no cross-workout id collision when the repeated draft is saved as a new workout.
- **Scope**: small, single-purpose diff consistent with the reviewable-code guideline.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint`) | Pass |
| Unit tests (`vitest`, 108 tests / 15 files) | Pass |
| Build (`next build`) | Pass |

E2E (`e2e/repeat.spec.ts`) added but not run here (requires live Clerk + Supabase env).

## Files Reviewed
- `src/app/page.tsx` — Modified (added Repeat icon-link to history row)
- `src/app/workout/[id]/workout-actions.tsx` — Modified (added Repeat workout link)
- `src/app/workout/new/page.tsx` — Modified (reads `?from`, validates, seeds logger)
- `src/app/workout/new/workout-draft.ts` — `detailToDraft` mapper (covered by tests)
- `e2e/repeat.spec.ts` — Added (E2E for the repeat flow)
