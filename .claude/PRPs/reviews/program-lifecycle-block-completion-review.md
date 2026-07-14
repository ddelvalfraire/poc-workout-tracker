# Code Review: Program Lifecycle — Block Completion State (Phase 2)

**Reviewed**: 2026-07-13
**Branch**: feat/program-lifecycle-block-completion (uncommitted, local review)
**Decision**: APPROVE (after fix applied)

## Summary
Clean implementation. `nextProgramWeek` verified byte-compatible (same reads, same order — the positional harness passes untouched); completion state costs zero extra queries on incomplete blocks; design-system discipline (one volt button, tnum, caps labels, sr-only PR arrows) holds. One MEDIUM finding, fixed in-session.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
- **Untested wiring of `blockComplete`/`mesocycleWeeks` onto `NextProgramDay`** — `src/db/instantiate-program.test.ts` (getNextProgramDay describe). Only `programWeekState` was unit-tested; the threading through `getNextProgramDay` (which drives the home hero banner) had no assertion, so hardcoding `blockComplete: false` would ship silently. **FIXED**: added a fully-done-final-week case asserting `blockComplete: true`, `mesocycleWeeks`, clamped week, and the wrap-to-first-day pick; the mid-block case now also asserts the flag stays false.

### LOW (noted, not blocking — both pre-existing)
- `getProgramStats` internally recomputes the current week via its own `nextProgramWeek` call, duplicating a read the page already made — only fires on completed blocks. Follow-up candidate: let it accept a pre-computed week.
- Tied `topPRs` deltas rely on stable sort + upstream `program-stats.ts` ordering for deterministic display order. Fine today; worth remembering if the upstream query changes.

## Reviewer verification highlights
- `pickNextProgramDay` wraps to the first day when every day of the week is logged (its docstring anticipates the finished-meso case), so the hero banner's data source stays non-null at completion.
- `mesocycleWeeks >= 1` is enforced at the Zod boundary (`src/lib/program-input.ts`), making the `<= 0` edge unreachable.
- No secrets, no `console.log`, no `any`; all reads remain `userId`-scoped.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint (changed files) | Pass |
| Tests | Pass — 945 (10 new) |
| Build | Pass |

## Files Reviewed
- `src/db/programs.ts` — Modified
- `src/db/instantiate-program.test.ts` — Modified (+1 test post-review)
- `src/app/programs/[id]/stats/stats-view.ts` — Modified
- `src/app/programs/[id]/stats/stats-view.test.ts` — Modified
- `src/app/programs/[id]/page.tsx` — Modified
- `src/app/next-workout-card.tsx` — Modified
- `.claude/PRPs/prds/program-lifecycle.prd.md` — Modified (docs)
