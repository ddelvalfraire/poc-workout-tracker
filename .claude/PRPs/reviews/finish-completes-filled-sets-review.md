# Review: Finish Completes Filled Sets (PR #62)

**Reviewed**: 2026-07-15
**Branch**: fix/finish-completes-filled-sets → main
**Decision**: APPROVE (after fix applied)

## Summary
Finish-time completion pass (`completeFilledSets`) + skipped-sets warning. Reviewer explicitly traced the two scary paths and cleared both: the dispatch-before-save ordering cannot reopen the draft-resurrection race (queue.settle() pauses autosave synchronously before React commits the re-render), and the async cross-device restore correctly clears a held warning whose snapshot draft went stale. 1 MEDIUM, fixed pre-merge.

## Findings

### CRITICAL / HIGH
None.

### MEDIUM (FIXED)
1. **Finish dialog violated ConfirmDialog's documented contract** — it closed itself before the save ran, making `isPending`/`pendingLabel` unreachable and losing in-dialog error/retry on failure (the discard dialog in the same file follows the contract). Fixed: the dialog stays open through the save with `error` wired in; the success path closes via `closeRef` before `router.push` (both branches), matching the discard pattern.

### LOW (addressed)
2. The resurrection-race safety of dispatch-before-await was implicit — a one-line ordering comment now pins it at the `finishWith` call site.

## Verified by the reviewer (not bugs)
- `handleSave(finalDraft)` fully switched (both draftToInput sites); `RESTORE_DRAFT` is pure and can't clobber name/openedAt; no other draft-replacing surface misses the `pendingFinish` clear; session-conflict flows live outside the logger.

## Validation
| Check | Result |
|---|---|
| tsc --noEmit | Pass |
| eslint (changed files) | Pass |
| Tests | Pass — 68 files / 1028 (5 new) |
| Build | Pass |
