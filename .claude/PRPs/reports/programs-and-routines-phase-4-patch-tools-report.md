# Implementation Report: Programs & Routines — Phase 4 (Granular Patch Tools)

## Summary
12 granular MCP patch tools (add/update/remove/move × day/exercise/set) so an agent can edit one node of a program without resending the whole document. New `src/db/program-patches.ts` holds the user-scoped ops (ownership via the join chain to `programs.user_id`, `updatedAt` bump per successful edit, contiguous renumbering on remove/move under the DEFERRABLE `program_sets` unique) with two failure channels: `null` = not-found, `ProgramPatchError` = invalid edit (last-set removal, merged-row rule violations, malformed technique/progression JSONB). `src/lib/mcp/program-patch-tools.ts` registers the tools: named scalar args (omitted = unchanged, `null` = clear), lazy display→kg conversion for `suggestedLoad`, empty-patch guards, `ProgramPatchError` surfaced verbatim as `ToolError`.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | XL (12 tools, highly repetitive) | XL — matched; symmetry made it mechanical |
| Confidence | High (established internal patterns) | High — no external research needed |
| Files Changed | 4 new + 2 edited | 4 new + 2 edited (+ PRD status row) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 0 | Branch `feat/programs-phase-4-patch-tools` | done | from `main` |
| 1 | `src/db/program-patches.ts` (12 ops + finders + `ProgramPatchError`) | done | |
| 2 | `src/db/program-patches.test.ts` (chain-recording tests) | done | 31 tests |
| 3 | `src/lib/mcp/program-patch-tools.ts` (12 tools) | done | |
| 4 | Wire `registerProgramPatchTools` in `tools.ts` | done | |
| 5 | `tools.test.ts` exact list 21 → 33 | done | |
| 6 | `src/lib/mcp/program-patch-tools.test.ts` (fake-server tests) | done | 34 tests |
| 7 | Full validation | done | dogfood deferred (optional per plan) |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `npx tsc --noEmit` clean; `npx eslint src` clean |
| Unit Tests | Pass | 65 new tests (31 db + 34 tool); `src/db` + `src/lib/mcp` = 279 pass |
| Build | Pass | `npm run build` succeeds |
| Full Suite | Pass | 391 tests, 34 files (worktrees excluded) |
| Edge Cases | Pass | empty patch, over-max load (lb-bound message), last-set guard, out-of-range move, not-owned at every level, no-user gate ×12, db-leak genericization |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/db/program-patches.ts` | CREATED | +733 |
| `src/db/program-patches.test.ts` | CREATED | +495 |
| `src/lib/mcp/program-patch-tools.ts` | CREATED | +627 |
| `src/lib/mcp/program-patch-tools.test.ts` | CREATED | +547 |
| `src/lib/mcp/tools.ts` | UPDATED | +5 / −2 |
| `src/lib/mcp/tools.test.ts` | UPDATED | +12 / −0 |

## Deviations from Plan
- **`addProgramSet` also validates the assembled row** (not just `updateProgramSet`'s merge). WHY: a fresh set defaulting to `metricMode: 'duration'` without `durationSec` would violate the Phase-1 rules the same way a merge can; the acceptance criterion "merged rows always satisfy the Phase-1 cross-field rules" is only meaningful if adds can't sneak an invalid row in. Same helper, one extra call.
- **`removeProgramSet` checks `count(*)` instead of delete-then-inspect**. WHY: the last-set guard must fire *before* the delete; contiguity makes `setNumber > count` a clean not-found without an extra read.
- **Import list**: `count` used instead of the plan's `asc` (never needed); otherwise as specified.

## Issues Encountered
None — all validation levels passed on first run after each task.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/db/program-patches.test.ts` | 31 | happy path + not-owned per level; merge-revalidation (duration/repMin-repMax/technique); last-set guard; renumber targets right table; splice both directions; max+1 appends; default-set seeding; empty-patch no-query |
| `src/lib/mcp/program-patch-tools.test.ts` | 34 | exact 12-tool registration; per-level happy paths with echo shapes; lazy unit resolution (no fetch for reps-only/null/explicit unit); empty-patch before unit fetch; over-max load in lb; `ProgramPatchError` verbatim; malformed id; no-user gate ×12; db-leak genericization |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Commit in two (db ops + tests, then tools + wiring + tests) per the plan's PR-size mitigation
- [ ] Create PR via `/prp-pr`
- [ ] Optional dogfood: author a program, swap an exercise, bump a set target, move a day, verify siblings untouched via `get_program`
