# PR Review: #120 — feat: program-derived weekly volume targets

**Reviewed**: 2026-07-31
**Author**: ddelvalfraire
**Branch**: feat/volume-targets → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The comparison is apples-to-apples where it must be (shared creditSetMuscles
extracted from the performed side, behavior-identical and test-pinned) and
deliberately asymmetric where it should be: planned excludes warm-up
prescriptions while performed keeps counting completed warm-ups — the
asymmetry can only flatter the lifter and is documented at one module doc
both sides reference. Active-program selection mirrors getNextProgramDay
(proposed structurally excluded); no-program renders byte-identical (no
plannedSets field → no bar, no legend, floor flag intact); 'Other' and
planned-0 groups never flag while untouched-but-planned groups do (correct:
with a plan, skipping is a shortfall). No migration — first reader of an
already-written table.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- OVER_PLAN_RATIO 1.5 is a fixed v1 constant — documented; tune with
  dogfood evidence.
- Planned is per-rotation-week compared against rolling-7d and calendar
  windows alike — the honesty caption covers it; a per-window proration was
  correctly not attempted.
- MCP stats surface lacks a muscle dimension — follow-up noted, not built.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 110 files, 1667 tests (19 new) |
| Build | Pass |
| Migration | None |

## Files Reviewed
- src/db/planned-volume.ts(+test) — planned aggregation, first program_exercise_muscles reader
- src/db/muscle-volume.ts — creditSetMuscles extraction (behavior identical)
- src/app/stats/volume-view.ts(+test), stats/page.tsx — under/over/fallback states
- src/components/charts/volume-bar-chart.tsx — optional planned bar
