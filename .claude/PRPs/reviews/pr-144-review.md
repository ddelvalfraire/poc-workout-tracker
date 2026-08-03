# PR Review: #144 — feat: home page redesign — status, not teasers

**Reviewed**: 2026-08-03
**Author**: ddelvalfraire
**Branch**: feat/home-status → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The build resolves the spike's three defects rather than restyling around
them: trained-today is now a designed payoff state instead of a gate-
induced absence, the two identical teaser rows collapse into one surface
with real hierarchy (one oversized number), and history drops to tier-2
with the full log moved intact to /history. The judgment calls the user
delegated are all defensible and documented: a seventh block-complete
state preserved from NextWorkoutCard (dropping it would regress the
completion payoff), the drifting headline naming the session that
actually happened rather than the up-next day (days-since must reference
real events), "last time" shipping as session volume because per-set
data isn't on the summary read and the zero-new-queries rule is hard,
and the program-reminder preference removed end-to-end because folding
its copy into the fresh hero left a toggle controlling nothing. Reuse
discipline held: bucketDaySets moved to lib and shared with the drawer
route instead of forked; Sparkbar extracted with byte-equivalent drawer
markup; deletions were grep-verified for importers (up-next-anchor
correctly kept — still imported elsewhere). Local-day logic stays
client-side with a fixed-height placeholder killing the mount jump.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- /history performs its own drafts read solely because Repeat is a start
  CTA needing the session guard — correct, and documented at the read.
- Momentum's strength-percent bar omitted (would add a read home forbids)
  — the goal row is label + flame only; revisit if the fact lands on an
  existing read.
- program_reminder_dismissed column orphaned by design (no migration in
  this PR) — candidate for a future schema-cleanup migration.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 157 files, 2201 tests (16 new state tests, +2 bucketDaySets) |
| Build | Pass (/history emits) |
| Migration | None |

## Files Reviewed
- src/lib/home-status.ts(+test) — Added: state machine + copy
- src/app/status-hero.tsx, momentum-panel.tsx, today-recap.tsx — Added
- src/app/history-list.tsx, history/page.tsx — Added: demotion + move
- src/components/sparkbar.tsx, src/lib/drawer-status.ts — Modified: shared extraction
- src/app/page.tsx, settings pages, workout/actions.ts — Modified
- next-workout-card, resume-session-card, trained-today-gate,
  today-workouts, program-reminder-card, program-reminder-toggle,
  lib/program-reminder(+test) — Deleted (grep-verified)
