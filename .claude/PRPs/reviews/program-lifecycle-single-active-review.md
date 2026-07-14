# Code Review: Program Lifecycle — Single-Active + Leave UX (feat/program-lifecycle-single-active)

**Reviewed**: 2026-07-12
**Branch**: feat/program-lifecycle-single-active (local, pre-commit)
**Reviewer**: typescript-reviewer agent + validation suite
**Decision**: APPROVE (no findings requiring changes)

## Summary
Single-active invariant in `setProgramStatus` (gate-before-sweep) and the "Leave program" confirm dialog. The security-critical ordering was verified airtight across both entry points, and the test harness was traced to confirm it genuinely pins the behaviors rather than asserting shapes.

## Findings

### CRITICAL
None. The sibling sweep is unreachable without the ownership-gated update returning a row; both entry points (server action via `requireUserId`, MCP tool via `resolveUserId`) funnel through the same function; the sweep's where-clause (`eq(userId) + eq(status,'active') + ne(id)`) is scoped to the caller's own rows only.

### HIGH
None.

### MEDIUM
None beyond the plan's accepted trade-offs (no transaction around activate+sweep — failure preserves today's state, self-heals; destructive-styled confirm on a non-destructive action — body copy compensates, revisit if it reads wrong in use).

### LOW
- `program-actions.tsx` — shared `isPending` across activate/leave/delete leaves a rapid-double-click window before React re-renders `disabled`. Pre-existing pattern (the delete flow's template), not a regression — noted for completeness, left as-is.

## Verified clean
- **Test harness honesty**: update order reflects true execution order (`.set()` records synchronously pre-await); the sweep-scoping assertion has no false-positive path — the gate's where never contains the literal `'active'` (that lives in `.set()`), and `whereParams` is index-addressed; `ownedRows = []` correctly exercises the no-sweep gate.
- **ConfirmDialog contract**: `closeRef` before refresh on success; in-dialog error retry; `isPending` re-enables on leave (island stays mounted) vs stays pending on delete (navigation unmounts) — correctly differentiated.
- **Type safety / a11y**: non-optional number props from non-nullable server values; no casts; dialog `aria-label` pattern reused; tsc/eslint clean.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass — 918/918 (5 new) |
| Build | Pass |

## Files Reviewed
- `src/db/program-status.test.ts` — Added
- `src/db/programs.ts` — Modified (`setProgramStatus` sweep + `ne` import)
- `src/app/programs/[id]/program-actions.tsx` — Modified (leave dialog)
- `src/app/programs/[id]/page.tsx` — Modified (week props)
- `src/lib/mcp/program-tools.ts` — Modified (description sentence)
