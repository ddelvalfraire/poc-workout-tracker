# PR Review: #279 — refactor: cut the coach's tool surface where the evidence supported it

**Reviewed**: 2026-08-20
**Author**: ddelvalfraire
**Branch**: refactor/coach-tool-surface → main
**Decision**: APPROVE (two findings fixed during review)

## Summary

Two independent cuts to the coach's 40-tool surface, each justified on its own
evidence rather than on a target number. Review found one real correctness bug
(a lossy pagination cursor) and one misleading test name; both are fixed in
`7fbbaf0`. The change is well-scoped, the persisted-name boundary is handled
correctly, and the claims in the PR body check out.

## Findings

### CRITICAL
None.

### HIGH

**1. `list_workouts` cursor silently dropped same-timestamp rows** —
`src/lib/mcp/read-tools.ts` — FIXED in `7fbbaf0`

`before` filtered on `startedAt` with a strict `<`, so paging past a row
dropped every other row sharing that instant, including ones never returned.

Not theoretical: `src/db/import.ts:106,116` dedupes on `(startedAt, name)`, so
two sessions imported from a date-only CSV are two distinct workouts sharing an
instant. Compounding it, `workoutSummariesQuery` orders by `desc(startedAt)`
alone (`src/db/workouts.ts:84`), leaving tied rows in no fixed order — two
identical calls could return different pages.

The in-repo precedent had already solved this: `list_program_changes` uses a
compound `(occurredAt, id)` cursor and documents it as tie-lossless. Fixed the
same way — `(startedAt, id)` in both the sort and the cursor filter, plus a
`beforeId` arg.

**2. In-place sort of a request-memoized array** —
`src/lib/mcp/read-tools.ts` — FIXED in `7fbbaf0`

The tie fix initially sorted the array returned by `listWorkoutSummaries`,
which is `React.cache`-wrapped. Sorting in place would have reordered the array
underneath every other caller in the same request (home page, history page,
drawer route). Now copies first, with a test pinning it.

### MEDIUM
None.

### LOW

**3. Test name miscounted the registered tools** —
`src/lib/mcp/program-patch-tools.test.ts` — FIXED in `7fbbaf0`

Renamed to "seventeen" when the actual count after the collapse is eighteen
(22 − 5 + 1). The assertion itself compares the sorted array, so it never
passed incorrectly — only the name lied.

## Verified, not findings

- **Persisted names survive the collapse.** `applyProposalPatch`
  (`src/db/patch-proposals.ts:97`) dispatches on the stored op name straight to
  db functions and never touches the MCP registry, so unregistering
  `set_program_diet_phase` as a tool cannot break pending proposals. The
  change-log `action` values in `db/program-patches.ts` are likewise untouched,
  so historical events still render.
- **The discriminated union serializes.** Registered the tools against a real
  `McpServer` over `InMemoryTransport` and inspected the emitted JSON Schema:
  valid nested `anyOf`/`oneOf`, 18 tools listed.
- **No chat-UI gap.** `LABELED_TOOLS` in `chat-ui.ts` never covered the five
  setters, and `toolStatusMessage` degrades to `humanizeToolName` for anything
  unlabeled.
- **Approval gating preserved.** `set_program_policy` sits in
  `COACH_APPROVAL_TOOLS`, so all five policies remain approval-gated exactly as
  before; renderer tests assert each still produces its original sentence.
- **Cache prefix intact.** `filterCoachTools` still sorts; its pinning test
  passes.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass (`tsc --noEmit` clean; 2 pre-existing errors in generated `.next/dev` types, present on main) |
| Lint | Pass (10 pre-existing problems, none in touched files) |
| Tests | Pass (336 files, 4,517 tests) |
| Build | Partial — compiles and typechecks; page-data collection needs `DATABASE_URL`, absent in this worktree. Environmental, not code. |

## Files Reviewed

| File | Change |
|---|---|
| `src/lib/mcp/read-tools.ts` | Modified — bounded `list_workouts` + compound cursor |
| `src/lib/mcp/read-tools.test.ts` | Modified — 7 new tests |
| `src/lib/mcp/program-patch-tools.ts` | Modified — 5 setters → `set_program_policy` |
| `src/lib/mcp/program-patch-tools.test.ts` | Modified — rewritten setter tests |
| `src/lib/mcp/tools.test.ts` | Modified — registry list |
| `src/lib/coach/tool-policy.ts` | Modified — allowlist |
| `src/lib/coach/describe-tool-call.ts` | Modified — 5 cases → 1 nested switch |
| `src/lib/coach/describe-tool-call.test.ts` | Modified — per-arm coverage |
| `TOOL-REFACTOR-BRIEF.md` | Modified — record of what was cut and deferred |
