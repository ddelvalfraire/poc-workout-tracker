# Review: Muscle Volume — Phase 1: Data Layer (PR #63)

**Reviewed**: 2026-07-15
**Branch**: feat/muscle-volume-data-layer → main
**Decision**: APPROVE (after fixes applied)

## Summary
Bucket map + window math + credit aggregation. Reviewer independently verified the calendar frame-shift math (negative offsets, year rollover), the credit dedup via Map semantics, resolver type alignment, and the deliberate no-upper-bound query. 1 HIGH + 1 MEDIUM + 2 LOW; all addressed pre-merge.

## Findings

### HIGH (FIXED)
1. **Rolling window silently dropped clock-skewed future sets** — `current.end = now` with end-exclusive `inWindow` meant a just-logged session whose `startedAt` sat minutes past server-now (the exact skew `recent-window.ts` documents and tolerates) fell outside BOTH windows and vanished from the counts. The codebase already fixed this failure class once (home "Done today" strip); this reintroduced it. Fixed: rolling `current.end` is the open far-future edge — future startedAt is current training. Regression tests added (window + aggregation level).

### MEDIUM (FIXED)
2. Calendar math untested at month/year boundaries — correct by inspection, now pinned: Jan 1 2027 resolving to the Dec 28 2026 Monday.

### LOW (FIXED)
3. Customs with `null` muscle arrays untested — resolver's empty-not-unknown reading now pinned.
4. Query's missing upper startedAt bound — confirmed deliberate ("horizon over-fetch tolerance"); reviewer noted an upper bound would have worsened the HIGH, not helped.

## Validation
| Check | Result |
|---|---|
| tsc --noEmit | Pass |
| eslint (new files) | Pass |
| Tests | Pass — 71 files / 1050 (22 new) |
| Build | Pass |
