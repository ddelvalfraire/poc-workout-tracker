# Implementation Report: wger Exercise Proxy (`/api/exercises`)

## Summary
Implemented Phase 2 of the workout-tracker PRD: a `GET /api/exercises` route handler that returns a searchable, typed list of exercises sourced live from wger's public API, mapped to `{ id, name, category, equipment? }`. Because wger removed its dedicated `/exercise/search/` endpoint in 2.5 (wger.de runs 2.6), the proxy fetches the full English catalog from `/exerciseinfo/?language=2` (2 paginated requests), caches it in memory via a `globalThis` singleton, and filters by `search`/`category` in-process. The route inherits Clerk middleware auth and adds no user scoping (exercise data is public reference data).

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium — accurate |
| Confidence | 9/10 | Implemented in a single pass, zero rework |
| Files Changed | 6 (4 create, 2 update) | 6 (4 create, 2 update) — exact |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `src/lib/wger.ts` — service + cache | ✅ Complete | Mirrors `src/db/workouts.ts` module shape + `src/db/index.ts` cache idiom |
| 2 | `src/app/api/exercises/route.ts` — GET handler | ✅ Complete | Returns bare `Exercise[]`; 502 + `{error}` on upstream failure |
| 3 | `src/lib/wger.test.ts` — service tests | ✅ Complete | 10 tests (added one beyond plan: "drops exercises with no English translation") |
| 4 | `src/app/api/exercises/route.test.ts` — handler tests | ✅ Complete | 5 tests (added "passes undefined options when no query params") |
| 5 | `.env.example` — document `WGER_API_BASE_URL` | ✅ Complete | Optional, defaults to public instance |
| 6 | PRD Phase 2 status → in-progress + plan link | ✅ Complete | Done during planning; flipped to `complete` in this report step |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (tsc) | ✅ Pass | `tsc --noEmit` zero errors |
| Lint (eslint) | ✅ Pass | New files clean; no `console.log` (only `console.error` for server error context) |
| Unit Tests | ✅ Pass | 20/20 across 4 files (15 new) |
| Build (`next build`) | ✅ Pass | `/api/exercises` registered as `ƒ (Dynamic)` |
| Integration (live wger) | ✅ Pass | Throwaway live test hit real wger.de, `searchExercises({search:'bench'})` returned real `{id,name,category}` rows; deleted after run |
| Edge Cases | ✅ Pass | Empty equipment, missing English translation, non-numeric limit, limit clamp, upstream non-ok — all covered by unit tests |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/wger.ts` | CREATED | +132 |
| `src/lib/wger.test.ts` | CREATED | +185 |
| `src/app/api/exercises/route.ts` | CREATED | +26 |
| `src/app/api/exercises/route.test.ts` | CREATED | +82 |
| `.env.example` | UPDATED | +4 |
| `.claude/PRPs/prds/workout-tracker-pwa.prd.md` | UPDATED | Phase 2 status + links |

## Deviations from Plan
- **Two extra unit tests** beyond the plan's list, for stronger edge coverage:
  - `wger.test.ts`: "drops exercises with no English translation" (verifies `mapExercise` null-drop path).
  - `route.test.ts`: "passes undefined options when no query params are given".
  - *Why:* both are cheap and lock down behaviors the plan described but didn't explicitly assert. No production-code change.
- Everything else implemented exactly as specified.

## Issues Encountered
- **Throwaway live test location**: Vitest only scans the project root, so the live integration check couldn't live in `/tmp`. *Resolution:* placed it at `src/lib/__livecheck.test.ts`, ran it, then deleted it (confirmed gone). Nothing network-dependent was committed.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/wger.test.ts` | 10 | mapping, English-name selection, empty-equipment omission, missing-translation drop, name/category filtering, limit clamp+slice, pagination, caching, upstream error |
| `src/app/api/exercises/route.test.ts` | 5 | JSON array success, query-param forwarding, default options, non-numeric limit, 502 error path |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Commit via `/prp-commit`
- [ ] Create PR via `/prp-pr`
- [ ] (Phase 3) Build the exercise picker that consumes `GET /api/exercises`
