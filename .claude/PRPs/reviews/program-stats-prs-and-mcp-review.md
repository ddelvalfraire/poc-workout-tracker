# Code Review: Program Stats — PRs + MCP Tool (feat/program-stats-prs-mcp)

**Reviewed**: 2026-07-12
**Branch**: feat/program-stats-prs-mcp (local, pre-commit)
**Reviewer**: typescript-reviewer agent + validation suite
**Decision**: APPROVE (initial WARNING resolved in-session)

## Summary
loggingType-aware progression scoring, per-exercise block PRs, and the MCP `get_program_stats` tool. One HIGH type-safety finding and one MEDIUM assertion nit, both fixed before commit; correctness, conversion parity, ownership gating, a11y, and test coverage all verified clean.

## Findings

### CRITICAL
None.

### HIGH
- `src/db/program-stats.ts` — `ProgramStatsRow.loggingType` was typed `string | null` and re-narrowed with an unchecked `as LoggingType` cast, inconsistent with the sibling `source` field's precise typing (drizzle already infers `LoggingType` from the column). **Fixed**: field typed `LoggingType | null`, cast removed.

### MEDIUM
- `stats/page.tsx` — `exercise.pr!` after a plain `.filter(...)` (no narrowing). **Fixed**: type-predicate filter; assertion dropped.

### LOW
- Single-week vs multi-week PR branches duplicate the `~{formatE1RM(baseline)}` markup — stylistic; left as-is (the two branches read clearer inline than a shared fragment).

## Verified clean
- `derivePR`: `best.e1rm ≥ baseline.e1rm` by construction (strictly-greater updates); `delta === 0` occurs only when baseline.week === best.week, so the `!isSingleWeek && delta > 0` guard has no reachable edge case. Tie policy matches `bestScoredSet`.
- MCP payload: every kg field converts via `kgToDisplay` (tonnage, effective weight, e1rm, PR endpoints); every non-weight field passes verbatim; internal `ScoredBestSet.index` dropped. Ownership double-gated (`programs.userId` + `workouts.userId`). Error handling structurally identical to `get_workout`, covered by shared-failure test rows.
- Tests pin the real behaviors: BW load basis, missing-bodyweight fallback, latest-wins loggingType, tie/regression weeks, `MAX_RELIABLE_REPS` boundary (12 false / 13 true), conversion parity, malformed-id short-circuit.
- Note: `assisted_bodyweight`'s negative-load→null path is covered in `one-rep-max`'s own tests (pre-existing), not re-tested at the aggregation layer — accepted.

## Validation Results (post-fix)

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass — 913/913 |
| Build | Pass |

## Files Reviewed
- `src/db/program-stats.ts` — Modified
- `src/db/program-stats.test.ts` — Modified
- `src/app/programs/[id]/stats/page.tsx` — Modified
- `src/app/programs/[id]/stats/stats-view.ts` / `.test.ts` — Modified
- `src/lib/mcp/read-tools.ts` / `.test.ts` — Modified
- `src/lib/mcp/tools.test.ts` — Modified (registry expectation)
