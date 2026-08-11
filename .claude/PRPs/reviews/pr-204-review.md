# PR Review: #204 — feat: the effort gate — overshoot-hold + trend veto (RPE plan slice 3)

**Reviewed**: 2026-08-10
**Author**: ddelvalfraire
**Branch**: feat/rpe-slice-3-effort-gate → main
**Decision**: APPROVE

## Summary
The plan's core slice, built to its own resolved decisions: a pure gate in a new module (file-size discipline), diet-phase seam shape copied exactly, two hold-only rules, no new load changes possible by construction.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
- `MAX_CREDIBLE_RIR` is duplicated between `effort-gate.ts` and `rolling-e1rm.ts` (both 3, both commented as the same guard). Acceptable now; export from one place if a third consumer appears.
- The synthesized fixed-mode hold persists on every derive while the newest session stays hot — intended (hold until effort normalizes), noted for behavior awareness.

## Correctness notes
- Synthesized hold composes with `applyAutoregToSets` via existing 'repeat' semantics: loads cap at the evidence bucket, never raise — the scheme's would-be increment is what's held.
- Gate runs only inside the autoregulation-enabled path (sessions exist only there); non-autoreg programs untouched.
- Order of rules: the decrement branch returns before overshoot logic — a stall session can never double-fire as overshoot.
- An existing fixed-mode 'repeat' verdict passes through by reference (load already held; annotating would claim credit the rep rules earned).
- Trend requires every window session scorable (holes break the chain) and a real net gain (0.5 kg floor) — monotonic noise can't veto.
- Cutting sanctity, activation floor, by-reference passthrough, +1 boundary, RPE↔RIR conversion, and floor-miss jurisdiction are all pinned in the 14 tests.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass (3,059 / 212 files; 14 new) |

## Files Reviewed
- `src/lib/effort-gate.ts` / `.test.ts` — Added
- `src/lib/autoregulate.ts` — effortContext field + 2 reason sentences
- `src/db/programs.ts` — gate applied after the diet gate
