# Implementation Report: Program Lifecycle — MCP `restart_program` (Phase 4)

## Summary
Claude can now roll a block over. `restart_program` is registered in `src/lib/mcp/program-tools.ts` beside `set_program_status`, composing the exact two db calls the UI's `restartProgramAction` makes: `cloneProgram(resolved, id)` (row-faithful copy, "Name — Block k", draft) → `setProgramStatus(resolved, clone.id, 'active')` (single-active sweep archives an active source). Payload echoes `{ userId, programId, sourceProgramId, status: 'active' }`. Fidelity guarantees hold by construction — the MCP path calls the same `cloneProgram` the Phase 3 fidelity tests pin down.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Small | Small |
| Confidence | 9/10 | Single-pass, zero rework |
| Files Changed | 4 | 4 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Failing tool tests (RED) | [done] Complete | 6 RED (count + 4 cases + gate row) |
| 2 | Register `restart_program` (GREEN) | [done] Complete | set_program_status template; fail-fast id shape check |
| 3 | Full-registry list | [done] Complete | tools.test.ts sorted array +1 |
| 4 | Full validation | [done] Complete | All levels green |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | tsc + eslint clean |
| Unit Tests | [done] Pass | 5 new tests |
| Build | [done] Pass | `next build` clean |
| Integration | N/A | Tool handlers exercised directly via the fake-server harness |
| Edge Cases | [done] Pass | not-owned (activate never called), activate-fails-post-clone, malformed id fail-fast, no-user gate |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/mcp/program-tools.test.ts` | UPDATED | +68 / -2 |
| `src/lib/mcp/program-tools.ts` | UPDATED | +33 |
| `src/lib/mcp/tools.test.ts` | UPDATED | +1 |
| `.claude/PRPs/prds/program-lifecycle.prd.md` | UPDATED | phase status |

## Deviations from Plan
None.

## Issues Encountered
None.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/mcp/program-tools.test.ts` | 4 + gate row | clone→activate order + echo; not-owned (no activation); activate failure; malformed id fail-fast; no-user gate |
| `src/lib/mcp/tools.test.ts` | (updated) | full registry incl. restart_program |

Full suite: 960 passed (955 pre-existing + 5 new).

## PRD Status
**All four phases of the program-lifecycle PRD are complete.** Phase 1 single-active invariant, Phase 2 block completion state, Phase 3 restart-as-clone, Phase 4 MCP parity.

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Deploy; reconnect the live MCP session so the new tool appears
