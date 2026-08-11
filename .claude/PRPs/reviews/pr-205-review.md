# PR Review: #205 — feat: effort-step proposals — sustained undershoot earns a confirmable +2.5% (RPE plan slice 4)

**Reviewed**: 2026-08-10
**Author**: ddelvalfraire
**Branch**: feat/rpe-slice-4-effort-step → main
**Decision**: APPROVE

## Summary
The plan's last slice, riding the reactive-deload machinery end to end: pure detector (M2-mirror two-session confirm), pure content builder (+2.5% overrides, validated against the proposal union in tests), trigger extension with explicit ask-priority rules.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
- The sweep now derives once per week for EVERY active autoregulated program (previously only reactive/cutting ones) — the Redis marker caps it and derivation is the page's own cost class, but it is a real cost widening; worth watching if program count ever grows beyond a dogfood corpus.
- Ask mutual-exclusion is maximally conservative: a deload-flavored `kind` suppresses the step ask even when the deload content itself nulls out — silence, never a mixed signal. Documented in the loop comment.

## Correctness notes
- Detector: both newest sessions must independently qualify (floor met, logged ≤ target − 1, same ε-load); any hole → null. Shares the gate's activation floor and top-pair discipline.
- Overshoot and undershoot cannot both fire (thresholds are disjoint by 2 full points).
- deloadPolicy 'none' keeps #197's suppression for deload kinds while step asks fire under any policy — a step-up is not a deload.
- Scheduled deload weeks can't be stepped (existing target-week skip covers both ask types).
- Patches validate against `proposalPatchesSchema` in tests — confirm-time re-validation can never reject a machine-raised step.
- Never auto-applied: the trigger writes an inert pending proposal; the program-page confirm is the only application path.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass (3,068 / 213 files; 9 new) |

## Files Reviewed
- `src/lib/effort-gate.ts` / `.test.ts` — sustainedUndershoot + 5 tests
- `src/lib/effort-step.ts` / `.test.ts` — Added (content + dedup matcher)
- `src/db/programs.ts` — effortStepLoadKg on ExercisePrescription
- `src/db/reactive-deload.ts` — sweep widening + step branch
