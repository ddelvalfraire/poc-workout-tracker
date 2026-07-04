# Implementation Report: Programs & Routines — Phase 3 (Instantiation)

## Summary
Closed the author→log loop. `instantiate_program_day` turns a program day into a dated `workout` — seeding each set's prescribed load into `weight` (only for `reps_weight`; reps/durations blank), stamped with provenance (`program_day_id`, `program_week`). `get_workout` and the `workout://{id}` resource now overlay the program prescription (rep range, RIR, set type, suggested load, technique) via a join, never writing targets into a `sets` row. Plans stay on the program; reality stays on the workout.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | 8/10 | Single-pass, no deviations |
| Files Changed | 1 new + 8 edited | 1 new + 8 edited |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `db/programs.ts`: `getProgramDayDetail` + `instantiateProgramDay` | Complete | Ownership via `day.program.userId`; one-transaction seed |
| 2 | `db/instantiate-program.test.ts` | Complete | 3 tests (`vi.hoisted` findFirst stub + recording tx) |
| 3 | `program-tools.ts`: overlay projection + tool | Complete | Extracted `buildProgramSetView`; exported `buildProgramDayView`/`ProgramDayView`; 6th tool |
| 4 | `program-tools.test.ts` | Complete | +5 tests; count 5→6 |
| 5 | `read-tools.ts`: `get_workout` overlay | Complete | `buildWorkoutPayload` gains optional `programDay`; payload gains provenance + `plan` |
| 6 | `read-tools.test.ts` | Complete | +2 overlay tests; `@/db/programs` mock; factory provenance |
| 7 | `resources.ts`: workout resource overlay | Complete | Parity with the tool |
| 8 | `resources.test.ts` | Complete | +1 overlay test |
| 9 | `tools.test.ts`: list 20→21 | Complete | `instantiate_program_day` |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `tsc --noEmit` clean (no `read-tools↔program-tools` cycle); `eslint src` clean |
| Unit Tests | Pass | 324 pass (excl. stray worktree); MCP+db 212; +11 this phase |
| Build | Pass | `next build` succeeds; route table unchanged |
| Integration | N/A | No new runtime route (MCP transport already serves these tools) |
| Edge Cases | Pass | not-owned day, malformed id, no-user gate, ad-hoc workout (no overlay, no query), default-week, duration-set seeds no weight |

## Files Changed

| File | Action | Lines (approx) |
|---|---|---|
| `src/db/programs.ts` | UPDATED | +95 |
| `src/db/instantiate-program.test.ts` | CREATED | +135 |
| `src/lib/mcp/program-tools.ts` | UPDATED | +75 / -12 |
| `src/lib/mcp/program-tools.test.ts` | UPDATED | +55 |
| `src/lib/mcp/read-tools.ts` | UPDATED | +18 / -2 |
| `src/lib/mcp/read-tools.test.ts` | UPDATED | +90 |
| `src/lib/mcp/resources.ts` | UPDATED | +6 / -1 |
| `src/lib/mcp/resources.test.ts` | UPDATED | +50 |
| `src/lib/mcp/tools.test.ts` | UPDATED | +1 |

## Deviations from Plan
None — implemented exactly as planned (9 tasks, the design from the plan's Design Detail).

## Issues Encountered
1. **Stray-worktree tooling pollution** persists (`.claude/worktrees/feat+unit-preference-kg-lb/`); scoped commands stay clean (`vitest run --exclude`, `eslint src`). Pre-existing; out of scope.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/db/instantiate-program.test.ts` | 3 | Seed provenance + per-metric load (reps_weight vs duration), blank achievements; not-owned/not-found → null, no transaction |
| `src/lib/mcp/program-tools.test.ts` | +5 | `instantiate_program_day`: default/explicit week, not-found, malformed id, no-user gate |
| `src/lib/mcp/read-tools.test.ts` | +2 | `get_workout` overlay (provenance + plan in lb); ad-hoc workout omits plan, no program query |
| `src/lib/mcp/resources.test.ts` | +1 | `workout://{id}` overlay |
| `src/lib/mcp/tools.test.ts` | updated | 21-tool list |

## Design Notes (as planned)
- **Seed = prescribed load, blank achievement.** `weight = suggestedLoadKg` only for `reps_weight`; reps/duration/distance blank. Targets (rep range, RIR, set type, technique) are NOT copied — read via the overlay join.
- **Overlay = live mirror, not a snapshot.** Editing/deleting the program changes/removes the overlay (`program_day_id` is `ON DELETE SET NULL`). A `plan_snapshot` column is the documented upgrade if historical fidelity is later needed.
- **`get_last_performance` unchanged** — program templates live in `program_*` (never queried); the clean-history criterion holds by the Phase-1 schema separation.
- **`program_week` is provenance only** here; Phase 5's progression engine reads it for week-N targets.

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Commit (Phases 1–3 stacked on `feat/programs-phase-1-schema`)
- [ ] **Phase 4** (granular patch tools) or **Phase 5** (progression engine + techniques)
