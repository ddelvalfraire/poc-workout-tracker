# PR Review: #104 — feat: autoreg v2 double progression

**Reviewed**: 2026-07-19
**Author**: ddelvalfraire
**Branch**: feat/autoreg-double-progression → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Engine logic reviewed directly: fill requires every scorable set confirmable
against today's tops AND at top (unconfirmable → hold — silence over
corruption); fill beats stall; stalls count consecutive comparable session
pairs with load mismatch breaking the streak; 4-session window yields exactly
the 3 pairs the 3-stall rule needs. The step is the one deliberate load-raise
and is documented as such, with schemeLoadKg preserved so "use plan as
written" still reverts. Fixed-rep/mixed-shape paths byte-identical to v1
(suite still green). The no-migration snapshot decision is sound: the range
top is a derive-time goal like incrementKg; performed facts stay snapshotted.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- A linear scheme that ran ahead of prescribed gets pulled back to one honest
  step on fill — intentional and documented, but worth watching in dogfood
  (the reason line makes it visible).
- Range mode widens the history read 3→4 sessions — marginal query cost.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 93 files, 1445 tests (19 new engine, derive/history updated) |
| Build | Pass |
| Migration | None (deliberate — documented at workingRangeTops) |

## Files Reviewed
- src/lib/autoregulate.ts(+test) — autoregulateRange, shared scorablePairs, step apply
- src/db/programs.ts — autoregPlan mode routing, workingRangeTops
- src/db/autoreg-history.ts(+test) — window widening (range only)
- src/db/derive-autoreg.test.ts — mode routing coverage
