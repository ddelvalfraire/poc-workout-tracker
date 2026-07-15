# Review: Muscle Volume — Phase 2: /stats Surface (PR #64)

**Reviewed**: 2026-07-15
**Branch**: feat/muscle-volume-surface → main
**Decision**: APPROVE (after fixes applied)

## Summary
/stats page (tiles, low-volume callout, paired-bar chart, window toggle) + home teaser. Reviewer verified fractional-credit float exactness (0.5 sums are IEEE-exact), the U+2212 minus convention, tz clamp/parse, ChartContainer height-vs-aspect-ratio spec behavior, and CVD/legend compliance. 1 HIGH + 1 MEDIUM-HIGH; both fixed pre-merge.

## Findings

### HIGH (FIXED)
1. **Hydration mismatch on the calendar link** — `getTimezoneOffset()` read during client-component render differs between server and client HTML. Fixed with `useSyncExternalStore` (server snapshot: tz-less href; client snapshot: real offset) after the first fix attempt (`setState`-in-effect) was itself rejected by the React Compiler lint — the store shape is the sanctioned pattern.

### MEDIUM-HIGH (FIXED)
2. **Home page gained the wger catalog on its critical path** — `getMuscleVolume` pulls `buildMuscleResolver` (catalog + Redis) but the teaser only needs totals. Fixed: new `getVolumeTotals` shares the flat query, skips muscle resolution entirely; test pins "getAllExercises never called" as the teaser's guarantee.

### Verified non-issues
Float exactness of 0.5-credit sums; minus-sign convention; tz param guarding; searchParams array handling; legend-present two-series identity; explicit-height vs `aspect-video` (CSS spec: aspect-ratio ignored when both axes definite).

### Noted for manual check
YAxis label width (82px vs "Hamstrings") and chart appearance at 320px — visual pass on the deployed page.

## Validation
| Check | Result |
|---|---|
| tsc --noEmit | Pass |
| eslint (changed files) | Pass |
| Tests | Pass — 72 files / 1055 (5 new this phase) |
| Build | Pass (/stats route) |
