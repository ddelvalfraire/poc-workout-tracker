# Code Review: Exercise Replacement — Logger Swap (Phase 1)

**Reviewed**: 2026-07-14
**Branch**: feat/exercise-replacement-logger-swap (uncommitted, local review)
**Decision**: APPROVE (after fixes applied)

## Summary
The reviewer verified reducer purity/immutability, the factory floor, dialog-stacking order (sheet closes before the guard mounts), and test quality — all clean. It caught one HIGH and one MEDIUM, both instances of existing codebase conventions the new code missed; both fixed in-session. Two LOWs accepted as design tradeoffs.

## Findings

### CRITICAL
None.

### HIGH
- **⇄ Replace button missed the save/discard freeze + navigation dialog-reset** — `workout-logger.tsx`. Every other draft mutation disables on `isSaving || isDiscarding`, and `handleSave`/`handleDiscard` synchronously zero all open dialogs before navigating (the #25 stranded-::backdrop convention); the new button and its two dialog states weren't covered, so a swap opened mid-save could strand its sheet/guard over the destination page. **FIXED**: `disabled={isSaving || isDiscarding}` on the button; `setReplaceTargetIndex(null)` + `setPendingReplace(null)` added to both handlers' reset blocks.

### MEDIUM
- **RESTORE_DRAFT didn't cancel an in-flight replace** — the cross-device restore clears the undo stack ("orphaned entries") but left `replaceTargetIndex`/`pendingReplace`, whose NUMERIC indices could silently retarget a different exercise under the restored draft. **FIXED**: both cleared in the restore effect with the same rationale comment — cancel, don't retarget.

### LOW (accepted by design, documented here)
- Undo-after-replace overwrites any sets logged into the replacement during the 5s window — accepted: the window is short and Undo is itself the recovery affordance; revisit if it bites in practice.
- A pick whose target vanished drops silently (sheet closes, no toast) — accepted: the window is a cross-device race measured in milliseconds; a toast would outweigh the case.

## Reviewer verification highlights
- `REPLACE_EXERCISE` case pure/immutable; `Math.max(1, setCount)` floor correct; `loggingType` reset consistent with `draftToInput`.
- Dialog order sound: `ExercisePicker.onAdd` → sheet `onClose()` runs before the guard's `showModal()` — no double-modal.
- The 5 new tests catch swapped-index and mutation regressions (sibling equality + reference asserts).
- a11y: labels present; Add-instead holds initial focus so Enter can't discard logged work.

## Validation Results (post-fix)

| Check | Result |
|---|---|
| Type check | Pass |
| Lint (src/app/workout/new) | Pass |
| Tests | Pass — 965 (5 new) |
| Build | Pass |

## Files Reviewed
- `src/app/workout/new/workout-draft.ts` — Modified
- `src/app/workout/new/workout-draft.test.ts` — Modified
- `src/app/workout/new/exercise-sheet.tsx` — Modified
- `src/app/workout/new/replace-confirm-dialog.tsx` — Added
- `src/app/workout/new/workout-logger.tsx` — Modified (+ 2 fixes post-review)
