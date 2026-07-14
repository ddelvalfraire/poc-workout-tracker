# Code Review: Program Lifecycle — MCP `restart_program` (Phase 4)

**Reviewed**: 2026-07-14
**Branch**: feat/program-lifecycle-mcp-restart (uncommitted, local review)
**Decision**: APPROVE

## Summary
Zero findings at any severity. The tool is a faithful mirror of `restartProgramAction` — same call order, same args, same failure seams — with module-consistent error text, fail-fast id shape check before any db call, and an accurate description that promises nothing `cloneProgram` doesn't deliver.

## Findings

### CRITICAL / HIGH / MEDIUM / LOW
None.

## Reviewer verification highlights
- **Parity**: resolveUserId → assertProgramIdShape → cloneProgram → ToolError-on-null → setProgramStatus(clone, 'active') → ToolError-on-null → payload; byte-equivalent semantics to `src/app/programs/actions.ts` (restartProgramAction).
- **Tests catch real regressions**: distinct ids (`PID` vs `'p-clone'`) make swapped args fail; the not-owned case asserts activation never fires; exact `toEqual` on the four payload keys catches renames; both registry lists alphabetically correct.
- **Conventions**: `/not found/` message format matches siblings; the new "Could not activate…" phrasing is a genuinely new failure seam, appropriately distinct.
- **Security**: userId resolution and ownership gate first in the chain; no impersonation surface added.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint (changed files) | Pass |
| Tests | Pass — 960 (5 new) |
| Build | Pass |

## Files Reviewed
- `src/lib/mcp/program-tools.ts` — Modified
- `src/lib/mcp/program-tools.test.ts` — Modified
- `src/lib/mcp/tools.test.ts` — Modified
- `.claude/PRPs/prds/program-lifecycle.prd.md` — Modified (docs)
