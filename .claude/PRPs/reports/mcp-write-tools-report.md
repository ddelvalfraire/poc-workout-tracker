# Implementation Report: MCP Write Tools (Phase 3)

## Summary
Added four write MCP tools so a connected agent can mutate a user's training:
`create_workout`, `update_workout`, `delete_workout`, and `set_weight_unit`. Each
resolves the target user via `resolveUserId`, accepts weights in the user's
display unit (converting to canonical kg via `displayToKg` before validation),
reuses `parseWorkoutInput` as the trust boundary, and wraps the existing
`src/db/*` writes. Validation failures and not-owned conditions surface as
`ToolError`; real DB errors are logged and genericized. The tools are aggregated
into `registerTools` via a new `registerWriteTools`, bringing the MCP surface to
11 tools.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | High (self-contained) | Confirmed — no codebase search needed during impl |
| Files Changed | 4 (2 new, 2 edited) | 4 (2 new, 2 edited) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Write tools (`write-tools.ts`) | Complete | 4 tools + `toKgInput`/`validate` helpers |
| 2 | Write-tools tests (`write-tools.test.ts`) | Complete | 14 tests, real validation/conversion, mocked db |
| 3 | Aggregate into `registerTools` (`tools.ts`) | Complete | `registerWriteTools(server)` after read tools; doc comment refreshed |
| 4 | Broaden tool-set assertion (`tools.test.ts`) | Complete | 11-name sorted set |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `tsc --noEmit` 0 errors; `eslint` on changed files exit 0 |
| Unit Tests | Pass | 14 write-tools tests; 48 MCP tests; 175 full-suite tests |
| Build | Pass | `npm run build` succeeds; `/api/[transport]` route present |
| Integration | N/A | Live MCP-client check is optional in the plan; not run |
| Edge Cases | Pass | empty input, no-user, null fields, not-owned, db-reject, unit override |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/mcp/write-tools.ts` | CREATED | +171 |
| `src/lib/mcp/write-tools.test.ts` | CREATED | +290 |
| `src/lib/mcp/tools.ts` | UPDATED | +5 / -3 |
| `src/lib/mcp/tools.test.ts` | UPDATED | +5 / -1 |

## Deviations from Plan
- **Helper placement**: defined `exercisesSchema`, `unitArg`, `RawWorkout`,
  `toKgInput`, and `validate` *above* `registerWriteTools` rather than below.
  Module-scoped `const` schemas are referenced inside the function's
  `inputSchema`, so they must be declared before use (the plan's snippet listed
  them inline within the tasks but did not pin ordering). Behavior identical.
- **`RawWorkout` named type**: used a named `type RawWorkout = { name?; exercises:
  z.infer<typeof exercisesSchema> }` instead of the plan's
  `Parameters<typeof toKgInput>[0]` self-reference, which is cleaner and avoids a
  circular type reference. Behavior identical.

## Issues Encountered
None. All validation passed on the first run after each task.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/mcp/write-tools.test.ts` | 14 | tool-set registration; create (kg conversion, unit override, stored-unit default, invalid input, db-reject, no-user); update (success, not-owned); delete (success, not-owned); set_weight_unit; parameterized no-user gate |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr` (stacked on `feat/mcp-read-tools`)
