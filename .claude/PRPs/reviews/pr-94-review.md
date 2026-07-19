# PR Review: #94 — feat: dismissible program reminder

**Reviewed**: 2026-07-18
**Author**: ddelvalfraire
**Branch**: feat/program-reminder-card → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Small vertical mirroring established patterns end-to-end (getter/setter clone
of restTimerEnabled, action clone of setRestTimerEnabledAction with auth +
boolean validation + revalidate, optimistic toggle with rollback). The
dismissed-flag inversion (storage: dismissed, UI: show) is commented at both
inversion points and covered by the truth-table test. Preference read rides
the page's existing Promise.all — no added waterfall.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Migration 0020 single additive column with default — safe on existing rows.
- Card renders only in the !nextDay branch: users with an archived program
  and no active day correctly count as "fresh" for this nudge.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 89 files, 1320 tests (8 new) |
| Build | Pass |
| Migration | Generated only (0020); apply via db:migrate at deploy |

## Files Reviewed
- src/db/schema.ts, drizzle/0020_* — Added flag column/migration
- src/db/preferences.ts — get/set following existing guards
- src/app/actions.ts(+test) — dismiss action
- src/lib/program-reminder.ts(+test) — pure gate
- src/app/program-reminder-card.tsx, src/app/page.tsx — home card wiring
- src/app/settings/program-reminder-toggle.tsx, settings/page.tsx — escape hatch
