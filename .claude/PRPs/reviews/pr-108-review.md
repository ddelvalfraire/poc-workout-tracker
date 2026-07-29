# PR Review: #108 — feat: autoreg outperform rule

**Reviewed**: 2026-07-29
**Author**: ddelvalfraire
**Branch**: feat/autoreg-outperform → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The upward-symmetric extension of the hardened engine. Invariant checks all
pass: anchors derive strictly from snapshotted facts (prescribed* + performed
rows); prescribedRepMin-as-snapshot-discriminator preserves cold-start
silence for pre-migration rows (the shipped invariant tests forced this);
all-or-nothing evidence gating means one at-plan or floor-missing set
silences the exercise; escape reverts cleanly incl. the null schemeLoadKg
case for load-less plans; warm-ups never score; precedence and fill-step
composition are documented and boundary-tested (104.9/105 on a 100 plan).
rpe-target reading history at derive is a necessary, contained change.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- evidence.scorableSets is 0 on pure null-load anchors (loaded-pair count) —
  the anchored evidence lives in anchorLoadBySetNumber; acceptable, noted in
  the report, but any future surface reading scorableSets for display should
  know.
- The 5% all-sets threshold is conservative by design; a single deliberate
  top-set overload won't anchor the whole exercise — matches
  silence-over-corruption, revisit only with dogfood evidence.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 98 files, 1545 tests (30 new) |
| Build | Pass |
| Migration | None |

## Files Reviewed
- src/lib/autoregulate.ts(+test) — anchor action, outperform/null-load rules, composition
- src/db/programs.ts — anchor-mode routing (rpe-target/weekly-volume/rep-progression)
- src/db/derive-autoreg.test.ts — routing coverage
