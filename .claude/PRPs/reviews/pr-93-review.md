# PR Review: #93 — feat: workout-complete moment

**Reviewed**: 2026-07-18
**Author**: ddelvalfraire
**Branch**: feat/workout-complete-screen → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Server-component-only feature. Verified: the finished param is presentation-
only and gated on isLive so edit saves never celebrate; getNextProgramDay is
fetched only when justFinished && programDayId, in parallel with the existing
history read (no waterfall); PR count reuses prBadgeRowIds (no third PR
computation); non-finished render path unchanged. resolveFinishUpNext is a
pure tested helper generic over { blockComplete } — no db import in lib/.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- getNextProgramDay(userId) returns the ACTIVE program's next day; if the
  finished workout belonged to a since-archived program, the card could show
  another program's up-next. Edge case accepted — helper returns none when
  next is null, and switching programs mid-session is rare.
- "Start when ready" links home rather than instantiating — deliberate
  (documented deviation; avoids minting a workout row on a mis-tap).

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 88 files, 1310 tests (4 new) |
| Build | Pass |

## Files Reviewed
- src/app/workout/new/workout-logger.tsx — Modified (finished=1 on live finish pushes)
- src/app/workout/[id]/page.tsx — Modified (param read, parallel fetch, celebration header)
- src/app/workout/[id]/finish-up-next-card.tsx — Added
- src/lib/finish-up-next.ts(+test) — Added
