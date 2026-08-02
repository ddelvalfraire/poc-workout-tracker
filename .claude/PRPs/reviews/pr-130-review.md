# PR Review: #130 — fix: /ops/product Date binds

**Reviewed**: 2026-08-01
**Author**: ddelvalfraire
**Branch**: fix/ops-product-dates → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Root cause traced to the mechanism, not the symptom: bare Dates in raw sql
fragments bind through drizzle's noop encoder (verified in drizzle source),
so postgres.js received a Date at Bind. The fix mirrors the codebase's
established pattern (workouts.ts ISO-string fragments), leaves the
never-at-risk typed comparisons untouched, and — the important part — closes
the mock blind spot that let this ship: the new test replays drizzle's
actual Bind step over recorded chunks and asserts no Date reaches the
driver, proven red on the unfixed code. All three read paths plus the
status-pill query verified ok:true against the real database pre-merge.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- The Bind-replay test helper is coupled to drizzle's queryChunks internals
  — acceptable as a regression tripwire; a drizzle major bump that breaks it
  breaks loudly in tests, which is the point.
- Process note: this class of bug argues for a live-DB smoke on future PRs
  that add raw sql fragments; noted for the workflow.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 1908 tests (2 new, red-on-unfixed verified) |
| Build | Pass |
| Live DB | getProductAnalytics / activity / getActiveUsers7d all ok:true |
| Migration | None |

## Files Reviewed
- src/lib/ops/product-analytics.ts — ISO serialization at raw fragments
- src/lib/ops/product-analytics.test.ts — Bind-replay regression tests
