# Local Review: PRs + Estimated 1RM

**Reviewed**: 2026-06-15
**Branch**: feat/last-time-inline (uncommitted)
**Decision**: APPROVE — all findings resolved (see Resolutions below)

## Resolutions (2026-06-15)
- **#1 DB-query test** — Added `src/db/exercise-history.test.ts` (3 tests): empty-id guard issues no query, row pass-through, and WHERE scopes by `userId` + ids + `startedAt` bound.
- **#2 Badge a11y** — `PR` span now carries `aria-label="Personal record"`.
- **#3 Tilde** — `~` wrapped in `aria-hidden="true"`; AT reads "Est. 1RM 117 kg".
- **#4 Duplicate-card PR** — PR is now decided per exercise across the whole workout (best of all its sets vs prior best) and the badge renders once, on the first card for that exercise.
- Re-validated: `tsc` 0 errors, lint clean, 126 tests pass, build OK.

## Summary
Clean, well-scoped implementation matching the plan. Math is isolated in a pure, tested
helper; the new query is user-scoped and guarded; render is server-side and synchronous.
No security or correctness blockers. Two MEDIUM gaps (no unit test for the new DB query,
minor a11y on the badge) and a couple of LOW nits.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

1. **No unit test for `getExerciseHistoryBefore`** — `src/db/workouts.ts`
   The empty-id guard (`inArray([])` invalid-SQL avoidance) and the `userId`/`startedAt`
   scoping are the security/correctness-critical parts of this change, yet they're only
   exercised by the (env-gated, not-run) e2e. Sibling queries have dedicated DB tests
   (`src/db/last-performance.test.ts`). Recommend mirroring that file: assert `[]` for empty
   ids, that rows from another user are excluded, and that the current/later workout is
   excluded by the time bound.

2. **`PR` badge has no accessible label** — `src/app/workout/[id]/page.tsx`
   The badge is a bare `<span>PR</span>`. Screen readers announce "P R" with no context, and
   it's purely visual otherwise. Consider `aria-label="Personal record"` (or a visually-hidden
   suffix) on the badge span.

### LOW

3. **`~` prefix is decorative** — `src/app/workout/[id]/page.tsx`
   `~{formatE1RM(...)}` renders "~117 kg"; the tilde may be read literally by AT. Minor; the
   "Est." label already conveys approximation. Optional.

4. **Same-exercise-twice in one workout** — both cards would compare against the same prior
   best and could each show PR. Acceptable edge for the POC (exercises are normally one card),
   but worth a note if duplicate cards become common.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint`) | Pass |
| Tests (`npm test`) | Pass (123) |
| Build (`npm run build`) | Pass |
| E2E (`test:e2e`) | Skipped (requires live Clerk + Supabase env) |

## Category Notes
- **Correctness**: PR semantics correct (strictly beats best of earlier workouts; first-ever = no badge). Time bound correctly excludes the viewed workout. Null/blank handled in `estimate1RM`/`bestSet`.
- **Type Safety**: No `any`; explicit types on all new exports; structural compat between `exercise.sets` and `bestSet`'s param verified by tsc.
- **Pattern Compliance**: Matches pure-formatter, user-scoped repository, and server-component render conventions.
- **Security**: Query parameterized (Drizzle), filtered by `userId` — no cross-user leak; no secrets; no injection surface.
- **Performance**: One extra sequential query per detail view (needs `workout.startedAt`); fetches all prior sets for the shown exercises. Fine at POC scale; documented in plan risks.
- **Completeness**: Unit tests for helpers + formatter; e2e written; missing DB-query unit test (finding #1).
- **Maintainability**: Small files, JSDoc with rationale, no magic numbers (`MAX_RELIABLE_REPS` constant, formula inline-documented).

## Files Reviewed
- `src/lib/one-rep-max.ts` — Added
- `src/lib/one-rep-max.test.ts` — Added
- `src/lib/format.ts` — Modified (added `formatE1RM`)
- `src/lib/format.test.ts` — Modified
- `src/db/workouts.ts` — Modified (added `getExerciseHistoryBefore`)
- `src/app/workout/[id]/page.tsx` — Modified (history load + render)
- `e2e/pr.spec.ts` — Added
- `.claude/PRPs/prds/...prd.md`, `.claude/PRPs/reports/...`, archived plan — Docs
