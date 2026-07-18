# PR Review: #73 — feat: unlock customs in the program builder and mid-session swaps

**Reviewed**: 2026-07-17
**Author**: ddelvalfraire
**Branch**: feat/custom-exercises-web-unlock → main
**Decision**: APPROVE (all findings fixed pre-merge)

## Summary
Web half of custom-exercises 4b. Independent reviewer verified the composite `source:id` re-keying end to end: `loadPlanTargets` (sole producer) and every logger consumer (`planFor`, overrides, snooze) agree; the replace-flow argument orderings match the server signatures exactly (the flagged-risky case); every `DraftProgramExercise` construction site threads `source`/`supersetGroup`; legacy localStorage drafts restore with backfills instead of being discarded (live code, directly tested).

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
1. **`isDraftProgramExercise` guard doesn't validate the two new fields** — deliberate (legacy snapshots lack them; backfill handles it; server Zod is the trust boundary), but undocumented — a future "fix" adding the check would discard every legacy draft. **Fixed**: explanatory comment added at the guard.

### LOW
2. **Stale comment in `exercise-sheet.tsx`** claiming the builder keeps `includeCustom` off. **Fixed.**
3. **Garbled docblock sentence in `workout/[id]/edit/page.tsx`**. **Fixed.**

## Validation Results

| Check | Result |
|---|---|
| Type check (tsc --noEmit) | Pass |
| Lint (eslint, changed files) | Pass |
| Tests | Pass — 74 files / 1089 tests (3 new this PR) |
| Build (next build) | Pass |

## Files Reviewed
- `src/app/programs/new/program-builder.tsx` — Modified (includeCustom)
- `src/app/programs/new/program-draft.ts` — Modified (source + supersetGroup through draft, backfill)
- `src/app/programs/new/program-draft.test.ts` — Modified (round-trip, legacy restore)
- `src/app/workout/new/workout-logger.tsx` — Modified (composite plan keys, ungated substitute flow)
- `src/app/workout/new/exercise-picker.tsx` — Modified (comment)
- `src/app/workout/new/exercise-sheet.tsx` — Modified (comment, review fix)
- `src/app/workout/[id]/edit/page.tsx` — Modified (composite loadPlanTargets keys)
