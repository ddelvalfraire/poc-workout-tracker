# Review: Stat-Tile Pattern (PR #61)

**Reviewed**: 2026-07-15
**Branch**: feat/stat-tiles → main
**Decision**: APPROVE (after fixes applied)

## Summary
Shared `StatTile` (label · value+unit · semantic delta · caption) replacing the exercise-detail record cards, plus proportional-figures typography fixes. Reviewer verified the delta math is exactly right (raw-kg difference before display rounding; best==first hides honestly), tailwind-merge order, and no orphaned imports. 2 MEDIUM + 1 LOW; both MEDIUMs fixed pre-merge.

## Findings

### CRITICAL / HIGH
None.

### MEDIUM (both FIXED)
1. **`formatVolume(...).replace(' kg','')` string surgery** — silently coupled the page to formatVolume's exact output shape. Fixed: value computed directly (`Math.round(kgToDisplay(...)).toLocaleString('en-US')`), matching formatVolume's rounding+grouping without the hack.
2. **`<dl>` → `<div>` semantic fork** — the workout summary and stats sheet keep dl/dt/dd for identical grids; the new tile forked the convention. Fixed: StatTile renders dt/dd internals (div-wrapped groups are valid dl content) and the page's grid is a `<dl>` again — the primitive is now dl-compatible for future adopters.

### LOW
3. Grouping inconsistency (1RM/heaviest values ungrouped vs volume grouped) — ACCEPTED; realistic 1RM/load values don't reach 4 digits; revisit if they do.

## Validation
| Check | Result |
|---|---|
| tsc --noEmit | Pass |
| eslint (changed files) | Pass (unused formatVolume import removed) |
| Tests | Pass — 68 files / 1023 |
| Build | Pass |
