# PR Review: #25 — fix: stop save-to-summary navigation from stranding overlays

**Reviewed**: 2026-07-08
**Author**: ddelvalfraire
**Branch**: fix/save-navigation-freeze → main
**Decision**: APPROVE (findings fixed in-branch)

## Summary
Correct, narrowly-scoped fix for the intermittent post-save freeze: navigation decoupled from the async transition (stranded ViewTransition snapshot) and the plate sheet's modal dialog now releases the top layer via close(). The one substantive finding — the same freeze pattern living in four sibling components — was fixed on this branch.

## Findings

### CRITICAL
None

### HIGH
- **[FIXED in 0448f21]** The identical `router.push`-inside-async-`startTransition` pattern existed in `workout-actions.tsx`, `start-day-button.tsx`, `program-actions.tsx`, and `program-builder.tsx` — the same intermittent freeze on delete/start/save flows. All four now await-then-navigate with a local pending flag.

### MEDIUM
None

### LOW
- Plate-sheet force-close during save restores focus to the original opener button, not the Save button — momentary and followed by navigation; intentional, left as-is.
- No component-level tests — consistent with the repo convention (pure-logic `.test.ts` only, zero `.test.tsx` anywhere).

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass (682) |
| Build | Pass |

## Files Reviewed
- src/app/workout/new/workout-logger.tsx — Modified
- src/app/workout/new/plate-sheet.tsx — Modified
- src/app/workout/[id]/workout-actions.tsx — Modified (follow-up fix)
- src/app/programs/[id]/start-day-button.tsx — Modified (follow-up fix)
- src/app/programs/[id]/program-actions.tsx — Modified (follow-up fix)
- src/app/programs/new/program-builder.tsx — Modified (follow-up fix)
