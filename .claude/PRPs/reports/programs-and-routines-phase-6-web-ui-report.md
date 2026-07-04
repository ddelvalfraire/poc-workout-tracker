# Implementation Report: Programs & Routines — Phase 6: Web UI

## Summary
The non-agent surface for programs: `/programs` (list), `/programs/new` (mobile-first multi-day builder), `/programs/[id]` (browse with engine-derived week-N targets, start-day, lifecycle), and `/programs/[id]/edit` (same builder in edit mode). Everything consumes the already-complete `db/programs.ts` — no new DB or engine code. Home gains a `Programs` link.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | — | High (all validation first-pass green, e2e passed on first run) |
| Files Changed | 12 (11 create, 1 update) | 12 (11 create, 1 update) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `program-draft.ts` pure draft module | Done | Pass-through carries `status`/program `notes` too (beyond plan's list) — required so an edit doesn't reset an active program to `draft` |
| 2 | `program-draft.test.ts` | Done | 16 tests, incl. JSONB pass-through + full detail→draft→input round-trip |
| 3 | `programs/actions.ts` (5 actions) | Done | GOTCHA verified: `updateProgram`'s delete+re-insert DROPS per-week override rows (cascade from `program_sets`; `insertProgramChildren` never re-inserts them). Documented in `updateProgramAction` JSDoc per plan's fallback |
| 4 | `/programs` list page | Done | |
| 5 | Builder (`new/page.tsx` + `program-builder.tsx`) | Done | Save also disabled when a day has 0 exercises (Zod `programDaySchema` min not called out in plan's gating list) |
| 6 | `/programs/[id]` detail page | Done | Consecutive identical derived sets grouped (`3×5 @ 105 kg · RPE 8`); Deload badge |
| 7 | `start-day-button.tsx` + `program-actions.tsx` | Done | `window.confirm` delete (matches `workout-actions.tsx`) |
| 8 | `/programs/[id]/edit` page | Done | |
| 9 | Home `Programs` link | Done | outline `lg` variant under Start Workout |
| 10 | `e2e/programs.spec.ts` | Done | Passed first run (15.8s): build → detail targets → start day → DB assertions → UI cleanup |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `tsc --noEmit` clean; new files ESLint-clean. Repo-wide `npm run lint` reports 17,908 pre-existing problems (identical with this work stashed — outside scope) |
| Unit Tests | Pass | 16 new tests; full suite 488/488 (36 files) |
| Build | Pass | `next build` clean; all 4 program routes registered |
| Integration (E2E) | Pass | `programs.spec.ts` 2/2 (setup + happy path) against live Clerk/Supabase |
| Edge Cases | Pass | Zero days/exercises/sets → Save disabled + Zod rejects; repMin>repMax sent as-is, server rejects → inline error; unowned → `notFound()`/throw; null loads render reps-only; deload sets tagged |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/app/programs/new/program-draft.ts` | CREATED | +371 |
| `src/app/programs/new/program-draft.test.ts` | CREATED | +432 |
| `src/app/programs/actions.ts` | CREATED | +105 |
| `src/app/programs/page.tsx` | CREATED | +107 |
| `src/app/programs/new/program-builder.tsx` | CREATED | +295 |
| `src/app/programs/new/page.tsx` | CREATED | +30 |
| `src/app/programs/[id]/page.tsx` | CREATED | +191 |
| `src/app/programs/[id]/start-day-button.tsx` | CREATED | +40 |
| `src/app/programs/[id]/program-actions.tsx` | CREATED | +86 |
| `src/app/programs/[id]/edit/page.tsx` | CREATED | +46 |
| `src/app/page.tsx` | UPDATED | +11 |
| `e2e/programs.spec.ts` | CREATED | +146 |

## Deviations from Plan
- **Draft carries `status` and program `notes` as pass-through** (plan listed only progression/technique/setType/metricMode/durationSec/distanceM). WHY: `updateProgram` full-replaces the `programs` row from the input; without carrying `status`, editing an *active* program would silently reset it to `draft`.
- **Save gating also requires ≥1 exercise per day**, mirroring `programDaySchema.exercises.min(1)` — the plan's gating list mentioned only zero days / zero sets.

## Issues Encountered
- **Override rows ARE dropped on UI edit** (the plan's Task 3 VERIFY): `updateProgram` deletes `program_days` and the FK cascade removes `program_set_overrides`; nothing re-inserts them. Documented in the action JSDoc — per-week overrides remain MCP-only and a UI edit of such a program loses them. Consider a future confirm dialog if agent+UI co-editing becomes real.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/app/programs/new/program-draft.test.ts` | 16 | reducer immutability/ordering, lb→kg conversion, blank handling, JSONB pass-through data-loss guard, detail→draft round-trip (kg + lb), factories |
| `e2e/programs.spec.ts` | 1 | build → browse targets → start day → seeded workout → UI delete cleanup, with direct Postgres assertions |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
