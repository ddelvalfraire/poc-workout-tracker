# Implementation Report: Program Stats — Data Layer (Phase 1)

## Summary
Created `src/db/program-stats.ts`: a read-only aggregate module turning program-linked workouts (provenance: `workouts.programDayId` + `programWeek`) into per-week adherence, per-week volume, and per-exercise e1RM progression — kg-domain throughout, ad-hoc workouts excluded by construction (inner join through `program_days`). TDD order respected: the 13-case test file was written first and confirmed failing before the module existed.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium — no surprises; all patterns pre-existed |
| Files Changed | 2 new + PRD edit | 2 new + PRD edit (exactly as planned) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Failing test file (RED) | Complete | 13 tests; module-not-found failure confirmed before implementation |
| 2 | Types + pure `aggregateProgramStats` (GREEN 1) | Complete | Accumulator helper `aggregateExercises` extracted from the start |
| 3 | Queries + `getProgramStats` (GREEN 2) | Complete | All 13 green on first run after module creation |
| 4 | Refactor + full validation (IMPROVE) | Complete | No refactor needed; checklists verified |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `tsc --noEmit` clean; eslint clean on both new files |
| Unit Tests | Pass | 13 new tests; full suite 879/879 (866 pre-existing untouched) |
| Build | Pass | `next build` compiled successfully |
| Integration | N/A | Data layer only; no route/UI surface until Phase 2 |
| Edge Cases | Pass | Full plan matrix covered (see below) |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/db/program-stats.ts` | CREATED | +272 |
| `src/db/program-stats.test.ts` | CREATED | +291 |
| `.claude/PRPs/prds/program-stats.prd.md` | UPDATED | Phase 1 → complete |

Zero schema changes / zero new migrations (PRD success metric held: latest migration remains 0013 from the bodyweight PR).

## Deviations from Plan
- **Reads 2–4 run in `Promise.all`** instead of strictly sequential. The plan's Design section listed them as sequential steps but its own `nextProgramWeek` mirror uses the parallel-reads idiom; the mock's queue order (dayCount, then flat rows) is preserved because `db.select()` calls are issued synchronously in argument order. Latency: one round-trip instead of three.
- **`aggregateExercises` extracted immediately** rather than waiting for the Task-4 refactor trigger — `aggregateProgramStats` would have exceeded the ~50-line bound otherwise.

## Issues Encountered
None.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/db/program-stats.test.ts` | 13 | Pure aggregation: empty block, single-week adherence/tonnage, multi-week progression + first-appearance ordering, null-weight machine sets, uncompleted seeded sets, started-but-empty workout, duration-mode sets, week overshoot, null programWeek guard, duplicate-day dedup. Mocked db: ownership-gate null (later reads skipped), 3-read + `nextProgramWeek` wiring, user+program scoping on gate and flat-rows reads |

## Semantics locked in code (from PRD open questions)
- Adherence counts **started** days; `daysCompleted` surfaces the gap rather than excluding.
- Tonnage: `completed = true` ∧ `reps_weight` ∧ reps & weight non-null; null-weight sets still count in `completedSets`.
- Progression `best`: `bestSet()` over completed sets only (seeded/abandoned sets can't score).
- `plannedDays` = current day count; mid-block edits shift history's denominator (commented).
- Deleted-day dropout comment present on the provenance join (PRD risk #1).

## Next Steps
- [ ] Phase 2: Stats UI (tab on program detail page) — consumes `getProgramStats`
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
