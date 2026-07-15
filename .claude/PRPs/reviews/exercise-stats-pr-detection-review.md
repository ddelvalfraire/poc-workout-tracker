# Review: Exercise Stats — Phase 4: Live PR Detection (PR #59)

**Reviewed**: 2026-07-15
**Branch**: feat/exercise-stats-pr-detection → main
**Decision**: APPROVE (after fixes applied)

## Summary
Pure detector + lean best-e1RM action + logger caption. Reviewer verified the dynamic `useQueries` usage, Fragment/key move, exercise-index alignment (incl. duplicate exercises), epsilon math (no genuine PR swallowed; numeric(6,2) precision within tolerance), and zero queries in edit mode. No CRITICAL/HIGH. 1 MEDIUM + 2 LOW; MEDIUM and one LOW fixed pre-merge.

## Findings

### CRITICAL / HIGH
None.

### MEDIUM (FIXED)
1. **Non-integer reps could flag a phantom PR** — the save path truncates `'5.9'` reps to 5 (`toReps` uses `parseInt`), but the detector scored 5.9, so a flag could be earned live that the persisted set wouldn't justify. Fixed: strict decimal parse + `Number.isInteger` guard on reps; tests added.

### LOW
2. **`Number()` accepts hex** (`'0x12'` → 18) — more permissive than the save path despite the comment claiming stricter. FIXED with the same strict `^\d+(\.\d+)?$` parser (also rejects exponent/sign forms); tests added.
3. **Fragment indentation not re-flowed** after the key moved — cosmetic, ACCEPTED (no Prettier gate in repo; re-indenting 140 lines would bloat the diff).

## Validation Results
| Check | Result |
|---|---|
| tsc --noEmit | Pass |
| eslint (changed files) | Pass |
| Tests | Pass — 69 files / 1028 |
| Build | Pass |

## Files Reviewed
pr-detection.ts(.test), actions.ts(.test), workout-logger.tsx (+ workout-draft toReps/toWeight, one-rep-max, exercise-stats as references).
