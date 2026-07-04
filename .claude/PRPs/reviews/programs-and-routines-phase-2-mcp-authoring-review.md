# Code Review: Programs & Routines — Phase 2 (MCP Coarse Authoring + Read)

**Reviewed**: 2026-06-28
**Branch**: feat/programs-phase-1-schema (local, uncommitted)
**Mode**: Local Review
**Decision**: APPROVE with comments

## Summary
Phase 2 adds the program MCP surface (`upsert_program`/`get_program`/`list_programs`/`delete_program`/`set_program_status` + `program://{id}`), twinning the workout tools. An independent `code-reviewer` pass confirmed all five core invariants hold (resolveUserId-before-DB authz, leak-safe ToolError/errorResult + ZodError reshaping, symmetric display↔kg with `distanceM`/JSONB untouched, malformed-id can't reach the DB, correct ZodRawShape). No CRITICAL or HIGH. One MEDIUM fixed during review.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
1. **`upsert_program` id-shape guard ran too late** — `src/lib/mcp/program-tools.ts`. `assertProgramIdShape(id)` was inside the `if (id !== undefined)` block, *after* `getWeightUnit` and full body validation, unlike `update_workout` which guards immediately after `resolveUserId`. A malformed update id caused a wasted unit query and a body-error-before-id-error two-round-trip for the agent. **FIXED**: moved the guard to right after `resolveUserId` (before any DB call / body validation); strengthened the malformed-id test to assert `getWeightUnit` is not called.

### LOW
None.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint src` + changed files) | Pass |
| Tests (`vitest run --exclude worktrees`) | Pass (313, incl. 38 new/updated this phase) |
| Build (`next build`) | Pass |

## Files Reviewed
- `src/lib/mcp/program-tools.ts` — Added (5 tools + `buildProgramPayload`; id-guard order fixed in review)
- `src/lib/mcp/program-id.ts` — Added (`assertProgramIdShape`)
- `src/lib/mcp/program-id.test.ts` — Added
- `src/lib/mcp/program-tools.test.ts` — Added (25 tests; +1 fail-fast assertion)
- `src/lib/mcp/resources.ts` — Modified (`program://{id}` resource)
- `src/lib/mcp/resources.test.ts` — Modified (+6 program-resource tests)
- `src/lib/mcp/tools.ts` — Modified (wire `registerProgramTools`)
- `src/lib/mcp/tools.test.ts` — Modified (20-tool list + `program` resource)
