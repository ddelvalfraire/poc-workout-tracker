# PR Review: #347 — fix(logger): warm-ups don't count as sets — engine pairing + row renumbering

**Reviewed**: 2026-08-30
**Author**: ddelvalfraire
**Branch**: claude/workout-warmup-set-position-874327 → main
**Decision**: APPROVE (findings fixed in 4ea6156 before merge)

## Summary
Role-ordinal pairing (plan targets, Prev history) and class-ordinal display numbering are correct, consistently wired, and pinned by genuine regression tests; persistence stays raw-positional as designed. The two maintainability findings were fixed on the branch before merge.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
- `workout-draft.ts` / `format.ts`: the ordinal-within-class rule was implemented twice (`setDisplayNumber` vs `resolveByRole`) with different loop shapes — a drift risk if the tagging rule ever changes. **Fixed (4ea6156)**: both now build on a single `classOrdinal` core in `lib/workout-input.ts`.

### LOW
- `setDisplayNumber` silently produced a plausible count for an out-of-range `setIndex` (all current call sites pass in-range indices). **Fixed (4ea6156)**: out-of-range now yields 0 — an impossible display number — with the contract documented and test-pinned.

## Verified correct
- `resolveByRole` ordinal math, overflow-to-undefined (no clamping), seeded-session degeneracy to positional lookup.
- Minimal-shape `setType: 'warmup'` stamping at both target producers; backoff/amrap correctly land in the non-warm-up bucket matching the draft's two-value tag domain.
- Technique-stage expansion inherits `setType`, so staged warm-up targets stamp correctly.
- `resolveRestTarget` signature change has exactly one production caller, fed through `resolvePlanTarget`.
- `WeightStepper` `displayNumber` rename: all call sites updated, aria messages well-formed.
- No remaining positional reads of plan targets or history; `note-capture`, `detailToDraft`, draft payload, and undo restore correctly stay raw-positional.
- New tests are genuine pins (fail against the old positional code), not tautologies.
- No secrets, no console.log, no injection surface (query-builder only).

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`npm run lint`) | Pass |
| Tokens drift (`npm run tokens:check`) | Pass |
| Tests (`vitest run`) | Pass — 6045/6045 |
| Build (`npm run build`) | Not runnable in this worktree (Turbopack hermetic-build limitation; unrelated to the PR — no config touched) |

## Files Reviewed
- src/lib/format.ts — Modified
- src/lib/rest-target.ts — Modified
- src/lib/workout-input.ts — Modified (review fix)
- src/app/workout/new/workout-draft.ts — Modified
- src/app/workout/new/workout-logger.tsx — Modified
- src/app/workout/new/weight-stepper.tsx — Modified
- src/app/workout/[id]/edit/page.tsx — Modified
- src/app/workout/actions.ts — Modified
- src/db/workouts.ts — Modified
- Corresponding test files (format, rest-target, workout-draft, workout-logger, weight-stepper ×2) — Modified
