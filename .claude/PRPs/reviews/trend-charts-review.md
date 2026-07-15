# Review: Trend Charts — shadcn/recharts adoption (PR #60)

**Reviewed**: 2026-07-15
**Branch**: feat/trend-charts → main
**Decision**: APPROVE (no fixes required)

## Summary
Shared `TrendChart` island (shadcn chart primitive, recharts 3.8) replacing both SVG sparklines. Reviewer verified the four suspicious areas were all sound: SSR sizing (explicit h-40 beats aspect-ratio), duplicate date labels (recharts `allowDuplicatedCategory` default keeps index-based tooltip pinning — same-day sessions safe), React 19 peer range (no react-is override), and prop forwarding for the aria attributes. Import graph confirmed: recharts reachable only from the two chart routes.

## Findings
### CRITICAL / HIGH
None.

### MEDIUM
1. *(speculative, resolved as misread)* Bodyweight aria-label "endpoints vs min/max" — the OLD aria-label already used chronological endpoints (`values[0] → values[last]`); the min/max corner labels were separate and are superseded by the real y-axis. Semantics unchanged; intentional. No change.

### LOW
2. No unit test for TrendChart's tick regex / rounding — ACCEPTED per convention (thin presentational wrapper; plate/rest sheets follow the same rule). Noted for revisit if the component grows logic.
3. Possible duplicate adjacent tick text for same-day points — cosmetic, accepted.

## Validation
| Check | Result |
|---|---|
| tsc --noEmit | Pass |
| eslint (changed files, incl. generated chart.tsx) | Pass |
| Tests | Pass — 68 files / 1023 (sparkline suite retired with its module) |
| Build | Pass |

## Files Reviewed
trend-chart.tsx, chart.tsx (vendored, light scan — dangerouslySetInnerHTML content is static theme config, not user input), both chart pages, bodyweight islands, package.json.
