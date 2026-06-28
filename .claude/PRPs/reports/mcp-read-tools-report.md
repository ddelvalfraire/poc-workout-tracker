# Implementation Report: MCP Read Tools (Phase 2)

## Summary
Added five read-only MCP tools to the in-app MCP server so a connected agent can review training and resolve exercise names: `list_workouts`, `get_workout`, `search_exercises`, `get_last_performance`, and `get_weight_unit`. Each user-scoped tool funnels its `userId` through `resolveUserId`, echoes the resolved id back, and renders weights in the user's stored unit (kg verbatim, lb rounded 1dp) via `kgToDisplay`. `search_exercises` takes no `userId` — the catalog is public reference data. A small `result.ts` DRYs the success/error envelope shared across the handlers.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium — as predicted |
| Confidence | High (self-contained) | Confirmed — no codebase search needed during implementation |
| Files Changed | 6 (3 new + 3 edited) | 6 (4 created, 2 edited) — `result.test.ts` counted as a 4th create; PRD doc + plan archive are workflow artifacts |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `result.ts` helpers | Complete | `jsonResult` / `errorResult` with `as const` literal types |
| 2 | `result.test.ts` | Complete | 3 tests (success shape, Error message, non-Error fallback) |
| 3 | `read-tools.ts` (5 tools) | Complete | Mirrors TOOL_REGISTRATION / USER_RESOLUTION / UNIT_CONVERSION; `e1rmFor` helper |
| 4 | `read-tools.test.ts` | Complete | 12 tests via `fakeServer()` + module mocks; real units/e1rm math |
| 5 | Aggregate into `registerTools` | Complete | `registerReadTools(server)` after `whoami`; header comment refreshed; ping/whoami untouched |
| 6 | `tools.test.ts` tool-set assertion | Complete | Broadened to the sorted 7-name set |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (tsc) | Pass | `npx tsc --noEmit` — zero errors |
| Lint | Pass (changed files) | `eslint` clean on all 6 mcp files. Repo-wide `npm run lint` reports pre-existing errors **only** in `.claude/worktrees/**/.next/build/**` generated artifacts — unrelated to this change |
| Unit Tests | Pass | 24 MCP tests green; full real suite 151 tests green |
| Build | Pass | `npm run build` succeeds; `/api/[transport]` route present |
| Integration | N/A | Optional live MCP-client check deferred (needs real Clerk user + running server) |
| Edge Cases | Pass | not-found, null reps/weight, no-history, no-user, db-reject, kg-identity all covered in unit tests |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/mcp/result.ts` | CREATED | +18 |
| `src/lib/mcp/result.test.ts` | CREATED | +35 |
| `src/lib/mcp/read-tools.ts` | CREATED | +200 |
| `src/lib/mcp/read-tools.test.ts` | CREATED | +280 |
| `src/lib/mcp/tools.ts` | UPDATED | +5 / -4 (import + `registerReadTools` call + comment) |
| `src/lib/mcp/tools.test.ts` | UPDATED | +11 / -2 (tool-set assertion) |

## Deviations from Plan
None of substance. The plan's per-handler `errorResult(error)` pattern, ISO date formatting, and null-weight passthrough were implemented exactly as specified. The local variable for the resolved user is named `resolved` (the plan's pseudocode used `userId` for both the arg and the resolved value); renamed for clarity to avoid shadowing the input argument.

## Issues Encountered
- **Full-suite noise:** `npm test` surfaces 9 failing files, all inside the stray `.claude/worktrees/feat+unit-preference-kg-lb/` worktree (a separate in-progress branch vitest scans because it's nested under the repo root). Real `src/` is fully green (151 tests). Pre-existing repo-hygiene gap (vitest/eslint don't exclude `.claude/worktrees/`); out of scope for this PRP.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/mcp/result.test.ts` | 3 | `jsonResult` / `errorResult` shaping + error narrowing |
| `src/lib/mcp/read-tools.test.ts` | 12 | All 5 handlers: registration set, unit conversion (lb + kg identity), ISO dates, null passthrough, est-1RM, not-found, no-history, exclude forwarding, no-user gate, db-reject |
| `src/lib/mcp/tools.test.ts` | (updated) | Tool-set assertion now covers the 7-name set |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Phase 3 (write tools) can proceed — disjoint tool set over the same data layer
