# Review: Custom Exercises — Phase 4a: MCP Lifecycle (PR #71)

**Reviewed**: 2026-07-16
**Branch**: feat/custom-exercises-mcp → main
**Decision**: APPROVE (after fixes applied)

## Summary
Three lifecycle tools (create/update/list custom exercises) + source-aware search_exercises and get_last_performance + source pass-through on workout write tools. Reviewer verified the ToolError rendering path (duplicate-name message surfaces verbatim), the `.catch(never-returning)` type soundness, and zod/SDK compatibility. 3 MEDIUM + 1 LOW findings; all four fixed pre-merge.

## Findings (all FIXED)

### MEDIUM
1. **MCP validation bounds diverged from and bypassed `customExerciseInputSchema`** — hand-rolled `namesArg` allowed 20 equipment entries where the app boundary caps 10, and the db layer trusts already-parsed input. Fixed: the tool args now reuse the schema's own `.shape` field validators (`custom-exercise-tools.ts:25-29`) — the two boundaries physically cannot drift.
2. **Silent swallow of real db errors in the search merge** — an outage fetching a resolved user's customs looked identical to "no user in scope". Fixed: user-resolution degrade stays silent (normal path), a customs db failure now `console.error`s before degrading (`read-tools.ts` search_exercises).
3. **`source: 'custom'` pass-through untested on `get_last_performance`** — only the default 'wger' branch was covered. Fixed: explicit custom-branch test asserting the composite lookup receives `('user_env', 'custom', 73, undefined)`.

### LOW
4. **`limit` didn't bound merged customs** — the wger leg was limited but the merged array could exceed it. Fixed: limit now caps the merged list, customs-first.

## Validation Results

| Check | Result |
|---|---|
| Type check (tsc --noEmit) | Pass |
| Lint (eslint src/lib/mcp) | Pass |
| Tests | Pass — 74 files / 1074 tests (7 new this PR) |
| Build (honest type-check grep) | Pass — 0 hits |

## Files Reviewed
- `src/lib/mcp/custom-exercise-tools.ts` — Added
- `src/lib/mcp/custom-exercise-tools.test.ts` — Added
- `src/lib/mcp/read-tools.ts` — Modified (customs merge, source arg)
- `src/lib/mcp/read-tools.test.ts` — Modified
- `src/lib/mcp/write-tools.ts` — Modified (source pass-through)
- `src/lib/mcp/tools.ts` / `tools.test.ts` — Modified (registration)
