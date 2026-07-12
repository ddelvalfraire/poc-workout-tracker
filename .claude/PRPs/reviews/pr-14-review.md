# PR Review: #14 — amrap-cycle scheme (5/3/1-style wave cycling)

**Reviewed**: 2026-07-05
**Author**: ddelvalfraire
**Branch**: feat/amrap-cycle-scheme → main
**Decision**: APPROVE (self-review; posted as comment — authors cannot approve their own PRs)

## Summary

Adds the seventh progression scheme and the first with per-set load differentiation.
Pure derivation (TM computed from week count, no stored state), additive schema change,
no migration, MCP tools inherit the variant automatically.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

- Deload-week semantics: amrap-cycle keeps its wave-row reps and applies the standard
  85%/half-sets deload on top of wave loads, rather than 5/3/1's canonical 40/50/60
  deload. Deliberate and documented in the schema comment — a canonical 5/3/1 deload is
  expressible as a fourth wave row with `deloadWeek: null`.
- `waveReps` inner-row lengths may diverge from `wave` inner rows (only outer length is
  refined); both clamp to their own last entry, so a mismatch degrades gracefully rather
  than erroring. Acceptable; noted.
- Local mutable counter builds the progressed-set index map; contained and commented.

## Verified invariants

- `repMin ≤ repMax` cannot break: a prescribed wave rep nulls `repMax`.
- Wave/percent indexing cannot go out of bounds: schema guarantees non-empty rows and
  the index clamps to `length - 1`.
- Week clamp beyond the mesocycle freezes the TM (finished meso re-runs its last week).
- No UI coupling: no hardcoded scheme lists outside the shared schema.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (changed files) | Pass — 0 errors, 0 warnings |
| Tests (`vitest run`) | Pass — 573/573 (7 engine + 3 schema tests added, written first) |
| Build (`next build`) | Pass |

## Files Reviewed

- `src/lib/program-input.ts` — Modified (union member + waveReps shape refine)
- `src/lib/program-input.test.ts` — Modified (valid variants, bounds, shape mismatch)
- `src/lib/progression.ts` — Modified (amrapCycleTargets, progressed-set indexing, per-set loads)
- `src/lib/progression.test.ts` — Modified (wave rows, cycling, TM bump, clamps, warmups, deload)
