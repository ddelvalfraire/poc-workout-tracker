# PR Review: #29 — fix: started sessions read as live everywhere, not done

**Reviewed**: 2026-07-08
**Author**: ddelvalfraire
**Branch**: fix/in-progress-session-visibility → main
**Decision**: REQUEST CHANGES → resolved (both MEDIUM findings fixed in cbb00fb)

## Summary
TTL/precedence logic, tests, SQL aggregate shape, banner href routing, MCP payload compat, and the >TTL edge case all verified sound. Two MEDIUM findings that undercut the PR's own goal, both fixed in-branch.

## Findings

### CRITICAL / HIGH
None

### MEDIUM
- **[FIXED]** The read-only summary route had no guard — an unfinished workout reached by URL (bookmark, bfcache, hand-edited path) still rendered as done. The page now redirects to the logger when `completedAt === null`.
- **[FIXED]** `resolveActiveSession` preferred *any* draft over a fresher started workout — an abandoned quick-log draft outranked the day just started. Same-key (same session) still lets the draft win; unrelated candidates now compare recency (draft last-touch vs workout start). +2 tests.

### LOW
- `completedSetCount` SQL aggregate covered only by keyword assertion — matches the file's existing convention (no DB-backed tests); noted for future integration-test infra.

## Validation

| Check | Result |
|---|---|
| Type check / Lint / Build | Pass |
| Tests | Pass (758; 10 new on this branch) |

## Files Reviewed
active-session.ts (+tests), db/workouts.ts (+completedSetCount), app/page.tsx, workout/[id]/page.tsx, workout/[id]/edit/page.tsx, resume-session-card.tsx, mcp/read-tools.test.ts.
