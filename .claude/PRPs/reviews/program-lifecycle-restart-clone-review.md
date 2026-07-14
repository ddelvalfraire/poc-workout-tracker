# Code Review: Program Lifecycle — Restart-as-Clone (Phase 3)

**Reviewed**: 2026-07-14
**Branch**: feat/program-lifecycle-restart-clone (uncommitted, local review)
**Decision**: APPROVE (after fix applied)

## Summary
Clean implementation with the fidelity guarantee verified: the reviewer diffed `cloneProgram`'s insert values column-by-column against every program table in `schema.ts` — nothing dropped. The clone tests use full-column `toEqual` assertions, so a dropped column or a swapped override remap would genuinely fail. Ownership gates and the single-active sweep timing are correct. One MEDIUM finding, fixed in-session.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
- **Completion-card Restart not gated against drafts** — `src/app/programs/[id]/page.tsx` (completion card action row). `ProgramActions` gates Restart on `status !== 'draft'`, but the card gated only on `blockComplete`, which derives purely from workout history — and day cards are startable regardless of status, so a fully-trained draft could render a working Restart button, contradicting the sibling entry point's invariant. **FIXED**: the card's Restart now carries the same `status !== 'draft'` gate (the card itself still renders — completion is a fact; only the action is gated).

### LOW (noted, not blocking)
- `nextBlockName` yields a leading-space name for an empty base (e.g. a name that is exactly the suffix pattern). Unreachable today — every save path enforces `min(1)` via Zod — latent edge only.

## Reviewer verification highlights
- Column-complete copy confirmed for `programs`, `programDays`, `programExercises` (incl. `supersetGroup`, `source`, `progression`), `programSets` (all target columns + `technique`), `programSetOverrides`, `programExerciseMuscles`.
- Override remap (`newSets[i]` zip) is sound under Postgres's VALUES-order RETURNING; the two-overrides-on-set-1 fixture would catch a swap.
- `restartProgramAction`: id typeof-guard, ownership via `cloneProgram`'s gate, clone-commits-before-activate failure seam documented.
- UI discipline: closeRef-before-navigate, stale-error reset on open, outline restart button (one-volt rule), affirmative volt confined to the dialog confirm; existing ConfirmDialog callers unaffected by the defaulted `confirmVariant`.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint (changed files) | Pass |
| Tests | Pass — 955 (10 new) |
| Build | Pass |

## Files Reviewed
- `src/lib/block-name.ts` — Added
- `src/lib/block-name.test.ts` — Added
- `src/db/clone-program.test.ts` — Added
- `src/db/programs.ts` — Modified
- `src/app/programs/actions.ts` — Modified
- `src/components/confirm-dialog.tsx` — Modified
- `src/app/programs/[id]/restart-program-button.tsx` — Added
- `src/app/programs/[id]/program-actions.tsx` — Modified
- `src/app/programs/[id]/page.tsx` — Modified (+ draft gate post-review)
- `.claude/PRPs/prds/program-lifecycle.prd.md` — Modified (docs)
