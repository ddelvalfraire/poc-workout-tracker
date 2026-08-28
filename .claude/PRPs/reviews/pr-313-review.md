# PR Review: #313 — Answer a stall in a deficit with a volume cut, not a load cut

**Reviewed**: 2026-08-27 (round 1: commit 237d54a; round 2: the escape-hatch work, 1f4904e)
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
| Build (`next build`) | Pass — compiled in ~30s, TypeScript clean, 47 static pages generated, service worker precache built |

**Getting the build to run in a worktree** (it does not work out of the box, and the
failure mode looks like a code error when it is not): the worktree carries its own
`package-lock.json`, so Turbopack pins the workspace root here and refuses to resolve
`next` from the primary checkout's `node_modules` — while Node's own resolution walks up,
which is why `tsc` and `vitest` pass and only `next build` fails. Symlinking is rejected
too ("Symlink [project]/node_modules is invalid, it points out of the filesystem root"),
and `npm ci` refuses because the repo's lockfile is out of sync with `package.json`
(`Missing: @emnapi/runtime@1.11.3` — pre-existing, unrelated to this PR). What works:
`cp -a <primary>/node_modules ./node_modules`, then run the build with a synthetic
`DATABASE_URL` — page-data collection reads it at module scope, and the primary
checkout's `.env.local` points at LIVE PRODUCTION, so it must not be borrowed for this.

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


---

# Round 2 — the escape-hatch work (1f4904e, 04a44f4)

**Decision**: APPROVE with comments. One MEDIUM found and fixed (8f39c2b); the rest are
recorded as accepted trade-offs.

## Findings

### CRITICAL / HIGH
None.

### MEDIUM

**M3 — A restored set lost its ghost across a reload. FIXED (8f39c2b).**
`trimmedTargets` were appended to the plan overlay only while `autoregReverted` held the
key — but the flag and the rows it adds have different lifetimes. The rows land in the
PERSISTED draft; the flag is component state (in-memory by design, documented at
`workout-logger.tsx:730`). So: revert, reload, and you had three rows with two ghosts —
the restored set came back blank. Fixed by appending the trimmed targets
unconditionally: targets are positional, so an entry past the last row is inert, and the
ghost is there the moment a row exists at that index. Bonus, and correct: a plain
`+ Add set` after a trim now gets the plan's own number for that set, which is exactly
what the lifter is re-adding.

### LOW

**L4 — Restored rows append to the END of the exercise.**
If an exercise carries backoff/amrap rows after its working block, a restored working set
lands after them rather than back in the working block. Ghost alignment stays correct
(row and target are both appended), only the visual order differs. Accepted: splicing
into position would need the plan's row roles in the logger, which it does not carry.

**L5 — `partitionVolumeCut` runs twice per exercise per derivation** — once inside
`applyAutoregToSets` for the survivors, once in `deriveDayPrescription` for the dropped
rows. Pure, cheap (one filter and one loop over a handful of sets), and the two calls
cannot disagree given identical inputs. Accepted over threading a second return value
through `applyAutoregToSets`, whose signature is used by every rule-set test.

**L6 — `trimmedSets` is not exposed in `preview_program_week`,** while `volumeCut` is: a
coach reading the MCP preview can see "3 sets → 2" but not what the third set was.
Completeness nit; the reason line carries the numbers that matter.

## Verified, not issues

- **The trim never reaches the seeded workout twice.** `instantiateProgramDay` seeds from
  `prescription[position].sets` only (`prescriptions.ts:688`) — `trimmedSets` is a
  read-side ride-along and cannot resurrect a dropped set into a logged session.
- **Technique rows restore correctly.** `toTargets` runs the dropped rows through the same
  `expandTechniqueStages` as the kept ones, so a trimmed drop-set restores one row per
  STAGE — matching what instantiation would have seeded.
- **Substituted exercises never inherit this plan's trimmed rows** — the overlay short
  circuits the append, so a swapped-in lift that happens to share an id with a trimmed
  plan slot keeps its own targets.
- **"As written" really means the plan's numbers.** `trimmedSets` carries unadjusted loads
  with per-week overrides merged on top, so the owner's explicit number wins on a restored
  row exactly as it would have on the original.
- **Repeated dispatches are safe** — the reducer applies each `ADD_SET` in order, so N
  trimmed targets restore N rows under React's batching.

## Validation Results (round 2, full suite)

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint .`) | Pass |
| Tests (`vitest run`) | Pass — 472 files, 5769 tests |
| Build (`next build`) | Pass — compiled, TypeScript clean, 47 static pages, SW precache |

## Files Reviewed (round 2)

| File | Change |
|---|---|
| `src/lib/autoregulate.ts` | Modified — `cutWorkingVolume` → `partitionVolumeCut` |
| `src/db/prescriptions.ts` | Modified — `ExercisePrescription.trimmedSets` |
| `src/app/workout/[id]/edit/page.tsx` | Modified — `toTargets` extraction, `trimmedTargets` |
| `src/app/workout/new/workout-logger.tsx` | Modified — overlay append + revert restores rows |
| `src/app/workout/new/workout-logger-autoreg-revert.component.test.tsx` | Added |
| `src/db/derive-autoreg.test.ts` | Modified — `trimmedSets` assertions |
