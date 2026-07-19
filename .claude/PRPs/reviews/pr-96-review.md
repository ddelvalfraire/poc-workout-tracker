# PR Review: #96 — fix: ghosts show plan targets only; Prev owns history

**Reviewed**: 2026-07-18
**Author**: ddelvalfraire
**Branch**: fix/ghost-source-mixing → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Sourcing-rule change verified at all three consumers: set-row ghosts are now
plan-only (planSetGhost), the Prev chip reads history exclusively (fill
follows what it shows), and the sticky next-up label layers typed values over
the plan target. Tap-to-complete adopts the DISPLAYED ghost, so one-tap
completion records the plan floor — coherent with what the lifter sees.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Behavior change (requested): ad-hoc exercises with history but no plan now
  show empty inputs — one-tap circle completion on an untouched set no longer
  adopts last time's numbers; the Prev chip carries that fill instead (one
  extra tap on that path). Explicitly the user's chosen trade.
- previousChipLabel's weight_reps both-fields rule still governs the next-up
  label, so a partial typed row can render no label — pre-existing contract.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 90 files, 1331 tests (3 new) |
| Build | Pass |

## Files Reviewed
- src/lib/format.ts(+test) — planSetGhost replaces the merge helper
- src/app/workout/new/workout-logger.tsx — Modified (ghost derivation, chip sourcing, next-up)
