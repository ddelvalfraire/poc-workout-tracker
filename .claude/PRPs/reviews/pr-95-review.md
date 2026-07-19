# PR Review: #95 — feat: strengthen all-time stats surfaces

**Reviewed**: 2026-07-18
**Author**: ddelvalfraire
**Branch**: feat/all-time-stats-strengthening → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Content/hierarchy redesign of the stats sheet and full stats page. Key
verifications: sheet dialog mechanics untouched (showModal recipe,
geometric-backdrop dismiss, close-before-push all byte-identical);
sessionBestSet honors the warm-ups-never-score invariant via the one-column
query widening (no new queries); both surfaces mark the same set by
construction (shared helper); bodyweight without known bodyweight degrades
to rep-fallback bold rather than a wrong e1RM.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Page history cards compute e1RM with bodyweightKg = null (page never
  fetched it) — silent degradation for BW types; acceptable, documented in
  the helper's contract.
- setType tolerance: missing setType treated as working (matches the column
  default), covered by test.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 90 files, 1328 tests (8 new) |
| Build | Pass |

## Files Reviewed
- src/lib/session-best-set.ts(+test) — Added shared best-set scorer
- src/app/workout/new/stats-sheet.tsx — Modified (body redesign only)
- src/app/exercises/[source]/[id]/page.tsx — Modified (hero tile, best-set marks)
- src/db/exercise-stats.ts(+test) — Modified (setType column widening)
