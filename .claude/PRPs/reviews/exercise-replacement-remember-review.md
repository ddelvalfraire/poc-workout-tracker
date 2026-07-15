# Code Review: Exercise Replacement — Ask-to-Remember (Phase 4)

**Reviewed**: 2026-07-14
**Branch**: feat/exercise-replacement-remember (uncommitted, local review)
**Decision**: APPROVE (after fixes applied)

## Summary
The reviewer verified position addressing, the triple ownership gate, reset-block completeness, and the accept-success overlay coherence — all clean — and caught one HIGH, one MEDIUM, and one LOW; all three fixed in-session.

## Findings

### CRITICAL
None.

### HIGH
- **First-match slot resolution could WRITE to the wrong slot** — `rememberSwapAction` resolved the program slot by first-match on `wgerExerciseId`; a day listing the same exercise twice would silently patch the occurrence the user never touched. First-match is fine for the READ path (Phase 3's ghosts), not for a permanent program mutation. **FIXED**: the action now `filter`s and throws on ambiguity ("exercise appears more than once in this day") — a rare retry-fails case beats a silent wrong-slot write.

### MEDIUM
- **Trash-removal left the prompt alive** — undoing a swap withdrew the remember prompt, but deleting the substitute via the trash icon didn't, leaving a prompt offering to persist an exercise no longer in the session. **FIXED**: `handleRemoveExercise` clears `pendingRemember` on `replacementId` match, same pattern as the undo branch.

### LOW
- **Finish could race an in-flight remember** — tapping Finish mid-`rememberSwapAction` navigated away from an in-flight plan edit (post-unmount setState, harmless but sloppy). **FIXED**: `isRemembering` joined the Finish button's disabled condition (momentary — one round-trip).

## Reviewer verification highlights
- Position addressing: `day.position`/`slot.position` are the stored columns `findOwnedExercise` addresses — correct.
- Ownership: triple-gated (getWorkoutDetail → getProgramDayDetail → updateProgramExercise's own gate) — no hole.
- Prompt gate reads the server `planTargets` prop, never the overlay — re-swapped substitutes can't re-prompt.
- All three reset sites (save/discard/restore) clear the prompt; Set updates are copy-then-add; role=status + one-volt rule hold.
- Accept-success coherence: in-session ghosts already keyed to the substitute via Phase 3's overlay; program surfaces revalidated.

## Validation Results (post-fix)

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass — 982 |
| Build | Pass |

## Files Reviewed
- `src/app/workout/actions.ts` — Modified (+ ambiguity guard post-review)
- `src/app/workout/new/workout-logger.tsx` — Modified (+ 2 fixes post-review)
- `.claude/PRPs/prds/exercise-replacement.prd.md` — Modified (docs)
