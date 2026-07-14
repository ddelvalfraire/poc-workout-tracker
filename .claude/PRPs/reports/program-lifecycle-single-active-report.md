# Implementation Report: Program Lifecycle — Single-Active + Leave UX (Phase 1)

## Summary
`setProgramStatus(…, 'active')` now archives the user's other active programs after the ownership-gated activate (single-active invariant, inherited by web + MCP), and the program page's bare "Archive" became a "Leave program" ConfirmDialog with honest copy ("Your workouts and stats are kept. You're in week N of M…"). Activate stays a direct tap.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Small | Small |
| Confidence | 9/10 | Held — single pass |
| Files Changed | 5 (+ PRD) | 5 (+ PRD, + this report) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Failing db tests (RED) | [done] Complete | 5 tests; exactly the sweep case RED |
| 2 | Single-active in `setProgramStatus` (GREEN) | [done] Complete | Gate-first ordering; no transaction (documented) |
| 3 | Leave dialog in ProgramActions | [done] Complete | Separate leave state/error/closeRef; week props from page |
| 4 | MCP description honesty | [done] Complete | Description only; behavior via shared db fn |
| 5 | Full validation | [done] Complete | 918/918, build clean |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | tsc + eslint on changed files |
| Unit Tests | [done] Pass | 5 new (sweep, gate-first security, non-active single-update ×2, scoping) |
| Build | [done] Pass | |
| Integration | N/A | Client island validated by build + manual pass (repo convention) |
| Edge Cases | [done] Pass | not-owned no-sweep; `ne(id)` exclusion; non-active statuses untouched |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/db/program-status.test.ts` | CREATED | +110 |
| `src/db/programs.ts` | UPDATED | +13 / −1 |
| `src/app/programs/[id]/program-actions.tsx` | UPDATED | +69 / −13 share |
| `src/app/programs/[id]/page.tsx` | UPDATED | +7 / −1 |
| `src/lib/mcp/program-tools.ts` | UPDATED | +1 / −1 (description) |

## Deviations from Plan
None — implemented exactly as planned.

## Issues Encountered
None.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/db/program-status.test.ts` | 5 | activate sweeps siblings (values + userId/ne(id)/active scoping), not-owned activate never sweeps, archive/draft single-update, gated-update scoping, return shape |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Commit + PR (branch `feat/program-lifecycle-single-active` → main)
- [ ] `/prp-plan` Phase 2 (block completion state)
