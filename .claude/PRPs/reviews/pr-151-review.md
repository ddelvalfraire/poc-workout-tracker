# PR Review: #151 — feat: motivation surfaces (UI audit Arc E)

**Reviewed**: 2026-08-03
**Author**: ddelvalfraire
**Branch**: feat/motivation-surfaces → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The single-truth discipline is the arc's backbone and it held three
times over. The week-tick row derives from the same walker as the
streak count (extracted, not forked — a tick disagreeing with the
number is impossible by construction, with an explicit consistency
test). Trophy fractions read the evidence the hints already gathered
in memory — zero added reads, the earned-family cost skip untouched,
and fractions are null wherever no honest number exists (clubs without
e1RM, streaks without schedule, binary blocks) so no fake progress
bars render. The goal share button was skipped rather than borrowing a
card type that would misstate the fact — the right call under the
no-new-routes constraint. The bodyweight tension formula is honestly
scoped (no fake percent without a start weight; monotonic closeness
for ordering only, documented). The EMA is time-decayed (irregular-
sample-safe, duplicate-instant-proof) and the direction line runs on
the trend series, not raw noise. TrendChart's extension is additive —
existing call sites unchanged.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Consistency tension uses the server-computed streak (UTC drift) for
  ordering only — the displayed streak stays client-computed; noted.
- Overflow menu is native details (repo has no dropdown recipe) —
  consistent with the programs-page pattern.
- Two documented cheap reads added (goals→bodyweight logs when a BW
  goal exists; body→active goals for the target line) — bounded.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 177 files, 2458 tests (40 new) |
| Build | Pass |
| Migration | None |

## Files Reviewed
- src/app/goals/page.tsx, consistency-progress.tsx,
  goal-card-actions.tsx, goal-create.tsx — Modified
- src/lib/goal-progress.ts(+test) — streakDetail walker + ticks + pace
- src/app/trophies/page.tsx, src/lib/trophies.ts(+test) — Modified
- src/app/body/* incl. compare-pair.ts(+test), photo-compare slider
- src/lib/bodyweight-trend.ts(+test), components/charts/trend-chart.tsx
