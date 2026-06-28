# Code Review: MCP Read Tools (Phase 2) — local uncommitted changes

**Reviewed**: 2026-06-27
**Branch**: feat/mcp-read-tools
**Decision**: APPROVE

## Summary
Five read-only MCP tools added cleanly on top of the Phase 1 patterns. The user-scoping boundary (`resolveUserId`), unit conversion (`kgToDisplay`), and error envelope are all applied consistently; tests are thorough and mirror the established `fakeServer` + module-mock style. No correctness, security, or type-safety defects found. Validation is fully green.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW
- **`src/lib/mcp/result.ts:15` — raw error messages forwarded to the MCP client.** `errorResult` returns `error.message` verbatim, so an underlying DB error string (and the `get_workout` not-found message, which echoes `userId`) reaches the agent. This is **by design** for the POC: the endpoint is unauthenticated, the agent itself supplies `userId`, it mirrors the existing `whoami` convention, and the plan explicitly defers structured error envelopes to Phase 4. No action needed now — noted so Phase 4 closes it.
- **`src/lib/mcp/read-tools.ts:58-61` — `get_workout` fetches the weight unit concurrently even on the not-found path.** `Promise.all([getWorkoutDetail, getWeightUnit])` means one redundant `getWeightUnit` query when the workout is missing/unowned. Negligible cost, and the concurrency avoids a request waterfall on the (common) happy path — acceptable trade-off, not worth a sequential rewrite.
- **Completeness — error/no-user paths unit-tested on `list_workouts` as the representative handler.** The other four handlers share the identical `try/catch → errorResult` + `resolveUserId` structure, so the mechanism is covered. Reasonable; flagged only for visibility.

## Notes (verified, no action)
- `sets.weight` is `numeric(…, { mode: 'number' })` (`src/db/schema.ts:44`) and `reps` is `integer` — both deserialize as JS `number | null`, so `kgToDisplay(s.weight, unit)` is correct at type **and** runtime. No numeric-as-string coercion bug.
- `search_exercises` correctly does **not** call `resolveUserId` (public catalog), matching `/api/exercises`.
- `Date` fields are `.toISOString()`-normalized; `null` reps/weights pass through untouched; `reps` is never unit-converted.
- Phase 1 `ping`/`whoami` left untouched — no drive-by refactor onto the new `result.ts` helpers (deferred to Phase 4 as planned).

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (changed mcp files) | Pass |
| Tests (`vitest run src/lib/mcp`) | Pass — 24/24 |
| Build (`next build`) | Pass (run during implementation) |

> Repo-wide `npm run lint` / `npm test` report failures **only** inside `.claude/worktrees/feat+unit-preference-kg-lb/` (a separate in-progress worktree and its `.next/build/` artifacts), not in `src/`. Pre-existing ignore-config gap, out of scope for this change.

## Files Reviewed
| File | Change | Verdict |
|---|---|---|
| `src/lib/mcp/result.ts` | Added | Clean |
| `src/lib/mcp/result.test.ts` | Added | Clean |
| `src/lib/mcp/read-tools.ts` | Added | Clean (2 LOW notes) |
| `src/lib/mcp/read-tools.test.ts` | Added | Clean |
| `src/lib/mcp/tools.ts` | Modified | Clean |
| `src/lib/mcp/tools.test.ts` | Modified | Clean |
| `.claude/PRPs/prds/mcp-agent-server.prd.md` | Modified (doc) | Phase 2 → complete |
