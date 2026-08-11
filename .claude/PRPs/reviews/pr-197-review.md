# PR Review: #197 — feat: deloadPolicy 'none' suppresses cutting-hold proposals

**Reviewed**: 2026-08-10
**Author**: ddelvalfraire
**Branch**: feat/none-suppresses-cutting-holds → main
**Decision**: APPROVE

## Summary
Three-file, product-decision change: mode-'none' programs stop receiving cutting-hold proposals while the engine's hold behavior (loads never drop uninvited) is untouched. Rule lives in the pure `reactiveDeloadKind` with the derive trigger short-circuiting redundant reads.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
- The derive gate now has two consecutive early returns (`mode === 'none'`, then `mode !== 'reactive' && !cutting`); collapsible, but the two-line form reads as policy-then-flavor and matches the comment.

## Correctness notes
- Ordering in `reactiveDeloadKind` matters and is right: the 'none' check precedes the cutting-hold check, so 'none' + cutting → null; 'scheduled'/'reactive' + cutting keep 'cutting-hold' (re-pinned in tests).
- `applyDietPhaseToAdjustment` is untouched: the backoff is still HELD under a cut regardless of policy — suppression affects only the proposal, never the applied loads. Silence over corruption holds.
- Existing pending proposals for 'none' programs aren't retro-deleted; they simply stop being raised. Acceptable — decline was always safe (decline = hold).

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass (pre-commit hooks) |
| Tests | Pass (3,027 / 208 files; 1 re-pinned + 1 new) |

## Files Reviewed
- `src/lib/reactive-deload.ts` — Modified (early 'none' return + doc)
- `src/lib/reactive-deload.test.ts` — Modified (re-pin + suppression test)
- `src/db/reactive-deload.ts` — Modified (derive short-circuit)
