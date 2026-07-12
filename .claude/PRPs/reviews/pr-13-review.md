# PR Review: #13 — Add rep-progression scheme to the progression engine

**Reviewed**: 2026-07-05
**Author**: ddelvalfraire
**Branch**: feat/rep-progression-scheme → main
**Decision**: APPROVE (self-review; posted as comment — authors cannot approve their own PRs)

## Summary

Additive engine extension: a sixth progression scheme progressing rep/duration targets
instead of load. Pure-function change, no migration, MCP tools inherit the new variant
via the shared schema. One correctness issue found during review and fixed in-branch.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

- **Fixed in 8f85b89** — `schemeTargets` cap could shrink a template target: with
  `repMin: 12, maxReps: 10`, week 1 derived `min(12, 10) = 10`, prescribing less than
  the template. A cap must halt the climb, never lower the start. Now
  `Math.min(raised, Math.max(cap, value))`, with a pinning test.

### LOW

- The rep-integrity invariant (`repMin ≤ repMax`) survives derivation because both
  fields bump by the same increment and clamp to the same cap — noted, no action.
- `steps` recomputed per set inside `schemeTargets`; negligible cost at real set
  counts, left as-is for readability.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (changed files) | Pass (repo-wide lint has 858 pre-existing errors, none in this PR) |
| Tests (`vitest run`) | Pass — 565/565 |
| Build (`next build`) | Pass |

## Files Reviewed

- `src/lib/program-input.ts` — Modified (new union member + no-op refine)
- `src/lib/program-input.test.ts` — Modified (variant/bounds/no-op tests)
- `src/lib/progression.ts` — Modified (schemeLoad case, schemeTargets helper, deload reversion)
- `src/lib/progression.test.ts` — Modified (6 behavior tests incl. cap regression)
