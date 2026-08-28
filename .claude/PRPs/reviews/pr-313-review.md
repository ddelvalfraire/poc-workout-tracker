# PR Review: #313 — Answer a stall in a deficit with a volume cut, not a load cut

**Reviewed**: 2026-08-27
**Author**: ddelvalfraire
**Branch**: claude/diet-phase-episode-8e962e → main
**Decision**: APPROVE with comments

## Summary

The change is well-scoped and lands exactly the §08 decision: the cutting gate stops
holding a load backoff behind an unsupported physiology claim and instead trims loaded
working-set volume, with the reason line stamped from what the application actually
produced. No CRITICAL or HIGH issues. The MEDIUM/LOW notes below concerned honesty of the
surrounding affordances and a load-bearing invariant that was implicit; all are now
fixed in follow-up commits.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1 — "Use the plan as written" could not restore a trimmed set. FIXED.**
The logger's revert (`workout-logger.tsx:752`) was LOAD-only: it replaced `loadKg` with
`planLoadKg`. A cutting hold changes no load, so the revert was a no-op — while the one
thing the adjustment *did* change, the set count, had no escape at all. The label
therefore announced "Using plan as written." over a plan that was still a set short.

Fixed by carrying the dropped rows to the surface that offers the escape:
`partitionVolumeCut` now returns them, `ExercisePrescription.trimmedSets` carries them as
the plan wrote them (unadjusted load, overrides on top), `loadPlanTargets` hands them to
the logger as `planAutoreg[key].trimmedTargets`, and reverting re-adds a row per trimmed
target — each wearing that target's ghost. Pinned by
`workout-logger-autoreg-revert.component.test.tsx`.

**M2 — A per-week override on a dropped set silently disappears.**
`deriveDayPrescription` merges overrides by `sourceIndex` AFTER `applyAutoregToSets`
(`prescriptions.ts:504`), so an override pinned to a trimmed set is simply never applied —
which reads against the documented precedence "an explicit per-week override always
outranks the adjustment". Existing precedent: a deload's `setFactor` resize
(`progression.ts:623`) drops overridden sets the same way, so this is consistent with the
app rather than novel. Fix applied: state it in the `applyAutoregToSets` docblock so the
precedence sentence is not read as absolute.

### LOW

**L1 — The proposal path depends on "drop from the END", implicitly.**
`reactiveDeloadProposalContent` emits `set_program_set_override` patches addressed by the
POST-trim derived `setNumber`. That is correct today only because the trim removes sets
from the end of the working block, so every surviving working set keeps its original
number; renumbering only shifts rows that come after. A future change dropping from
anywhere would silently mis-address overrides. Fix applied: comment + a test pinning the
surviving numbers.

**L2 — No explicit test that a NON-cutting decrement leaves the set count alone.**
Covered indirectly by the byte-identity tests. Fix applied: direct assertion.

**L3 — Engine copy remains English-only** (`autoregReason`, `reactiveDeloadProposalContent`).
Pre-existing gap for this module, not introduced here; noted so it is not mistaken for
regression.

## Verified, not issues

- **The trim does not compound week over week.** Each derivation starts from the program
  template via `deriveWeekSets`, so a repeated stall re-derives `ceil(n × 2/3)` from the
  template count — it does not ratchet 3 → 2 → 1 across sessions.
- **Composition order holds.** `applyEffortToAdjustment` runs after the diet gate and
  returns a cutting verdict untouched (`effort-gate.ts:148`), so the trim cannot be
  reopened by the effort gate.
- **Deload weeks and timed rows are excluded** (`derivedFrom === 'scheme'`,
  `metricMode === 'reps_weight'`), so a scheduled deload week is not double-reduced and a
  fully-timed exercise is untouched.
- **The one-set floor is enforced before the drop count is computed**, so a single-set
  exercise is never emptied and `stampVolumeCut` correctly reports nothing.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint .`) | Pass |
| Tests (`vitest run`) | Pass — 471 files, 5763 tests |
| Build (`next build`) | Skipped — this worktree has no local `node_modules`; the build fails at Next.js workspace-root resolution before compiling any source. Must be verified from the primary checkout / CI. |

## Files Reviewed

| File | Change |
|---|---|
| `src/lib/autoregulate.ts` | Modified — gate, trim, stamp, copy |
| `src/lib/autoregulate.test.ts` | Modified — new coverage |
| `src/db/prescriptions.ts` | Modified — `stampApplication` helper |
| `src/db/derive-autoreg.test.ts` | Modified |
| `src/lib/reactive-deload.ts` | Modified — proposal copy |
| `src/lib/reactive-deload.test.ts` | Modified |
| `src/lib/mcp/program-tools.ts` | Modified — `volumeCut` in payload |
| `src/lib/mcp/program-tools.test.ts` | Modified |
| `src/app/programs/new/program-builder.test.tsx` | Modified — hint copy |
| `src/app/workout/new/workout-logger.tsx` | Modified — comment only |
| `messages/en.json` | Modified — builder hint |
| `docs/specs/diet-phase-as-an-episode.md` | Modified — status |
