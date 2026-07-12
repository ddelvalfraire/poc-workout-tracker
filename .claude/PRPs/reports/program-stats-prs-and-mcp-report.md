# Implementation Report: Program Stats — PRs + MCP Tool (Phases 3 & 4)

## Summary
Progression scoring migrated from `bestSet` (raw weight — wrong for bodyweight types) to `bestScoredSet` with per-exercise `loggingType` and the stored bodyweight; per-exercise Program PRs (first scored week baseline → best e1RM) derived in the data layer and rendered as a PRs section on the stats page with volt delta and `MAX_RELIABLE_REPS` high-rep flagging; new MCP `get_program_stats` read tool returns the same numbers unit-converted.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | 9/10 | Held — one pass, minor test-side fixes only |
| Files Changed | 7 (+ PRD) | 8 code files (+ PRD, + this report) — `tools.test.ts` registry expectation was the extra |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Failing data-layer tests (RED) | [done] Complete | 11 RED incl. one deliberate expectation change (machine week: null → reps-fallback best) |
| 2 | Data layer (GREEN) | [done] Complete | `bodyweightKg` as optional-defaulted param (deviation, see below) |
| 3 | Failing view-helper tests (RED) | [done] Complete | `prDeltaKg`, `isHighRepEstimate` boundary at 12/13 |
| 4 | Stats page PRs + honest progression | [done] Complete | |
| 5 | Failing MCP tests (RED) | [done] Complete | + shared-failure table row |
| 6 | MCP `get_program_stats` (GREEN) | [done] Complete | |
| 7 | Full validation | [done] Complete | 913/913, build clean |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | tsc + eslint on changed paths |
| Unit Tests | [done] Pass | 18 net-new tests across 3 files |
| Build | [done] Pass | route list unchanged |
| Integration | N/A | MCP handlers covered by the fake-server harness |
| Edge Cases | [done] Pass | missing bodyweight, mixed loggingType, tie weeks, rep-fallback-only, malformed id |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/db/program-stats.ts` | UPDATED | +95 |
| `src/db/program-stats.test.ts` | UPDATED | +172 |
| `src/app/programs/[id]/stats/page.tsx` | UPDATED | +97 |
| `src/app/programs/[id]/stats/stats-view.ts` | UPDATED | +20 |
| `src/app/programs/[id]/stats/stats-view.test.ts` | UPDATED | +33 |
| `src/lib/mcp/read-tools.ts` | UPDATED | +88 |
| `src/lib/mcp/read-tools.test.ts` | UPDATED | +101 |
| `src/lib/mcp/tools.test.ts` | UPDATED | +1 (registry expectation) |

## Deviations from Plan
- `aggregateProgramStats`'s `bodyweightKg` is an optional parameter defaulting to `null` rather than a required trailing param — identical semantics, keeps the existing pure-aggregate call sites valid (the plan itself said "existing calls pass null").
- One pre-existing test's expectation changed (plan anticipated the behavior, not the specific test): a null-weight machine week's best is now a `reps`-fallback instead of `null` — the effort reads as "8 reps", which is the feature, not a regression.
- `src/lib/mcp/tools.test.ts` (whole-server registry list) needed the new tool name — not in the plan's file list.

## Issues Encountered
- Discriminated-union narrowing in tests (`ScoredBestSet`) needed explicit kind guards — fixed in the test files, no production impact.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/db/program-stats.test.ts` | +12 | loggingType scoring (BW/weighted basis, missing bodyweight, latest-wins), PR derivation (baseline/best/single/tie/regression), bodyweight plumbed through `getProgramStats` |
| `stats-view.test.ts` | +3 | PR delta, high-rep boundary at `MAX_RELIABLE_REPS` |
| `read-tools.test.ts` | +5 | registration count, unit conversion parity, not-found, malformed id, shared failure/no-user rows |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] PR via `/prp-pr` (stacked: `feat/program-stats-prs-mcp` → `fix/start-any-week`)
- [ ] Post-deploy: ask Claude "how's my program going?" to exercise the live tool (PRD success signal)
