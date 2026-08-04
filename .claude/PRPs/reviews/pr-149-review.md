# PR Review: #149 — feat: the block map (UI audit Arc C)

**Reviewed**: 2026-08-03
**Author**: ddelvalfraire
**Branch**: feat/block-map → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The standout engineering call is the collapse mechanism: URL-state
expansion instead of a details element, chosen for exactly the right
reason — details would still server-render (and therefore derive)
hidden prescriptions, so the perf win would have been fake. With
shouldDeriveDay gating the loop, collapsed days genuinely skip the
per-exercise history and autoreg reads, and the expand param is parsed
defensively like the existing week param. The one-visual-truth goal
holds: a single tested builder (completed + full-provenance rows only,
deduped by day — the provenance memory's counting rule respected) and
a shared segment renderer serve all three screens; stats swapped its
bespoke day squares for the shared geometry while keeping its volume
bars. The autoreg card is honestly scoped — it only reports
prescriptions the page actually derived, so collapsed days contribute
nothing rather than triggering hidden reads, and it surfaces only
stall states (repeat/decrement), not progress. The list hero's extra
reads are bounded to the single most-recent active program and
documented.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Expand state resets on week switch by construction — correct
  behavior, worth knowing it's implicit rather than explicit.
- The autoreg card can under-report when relevant days are collapsed
  (no derivation → no note) — consistent with the no-hidden-reads
  rule; documented.
- Multiple active programs: only the most recent gets the hero
  (matches getNextProgramDay's recency rule) — noted.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 171 files, 2383 tests (40 new) |
| Build | Pass |
| Migration | None |

## Files Reviewed
- src/components/block-weeks.ts(+test), block-map.tsx — Added
- src/app/programs/list-view.ts(+test), page.tsx — Added/Modified
- src/app/programs/[id]/detail-view.ts(+test), page.tsx — Added/Modified
- src/app/programs/[id]/stats/page.tsx — Modified (shared segments)
