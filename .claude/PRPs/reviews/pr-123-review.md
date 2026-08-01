# PR Review: #123 — feat: program-suggested body check-ins

**Reviewed**: 2026-07-31
**Author**: ddelvalfraire
**Branch**: feat/checkin-cadence → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The threading mirrors the hard-won planSync discipline exactly (preserve-on-
omit proven, explicit-null-clears distinguished from omitted, clone carry,
MCP preservation note extended to all three program-level scalars). The
cron rider is the risky edit and it's handled: the workout block's continue
became if/else so the rider runs for every subscribed user — with a
regression test proving the old shape would have starved it — own marker
namespace, claim-before-send, null-cadence leaves the workout path
byte-identical. Due logic multi-source max is pure and truth-table tested;
the home card's dismiss is local-day-keyed sessionStorage and hydration-
gated. db/check-in split from the pure lib keeps the client bundle clean.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Cron cost grows by up to three latest-entry reads per subscribed user
  (skipped entirely when no cadence) — fine at scale-of-one.
- Reminder copy uses the program name possessively; long names truncate in
  push UI — cosmetic.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 1770 tests (26 new) |
| Build | Pass |
| Migration | Generated only (0028); apply at deploy |

## Files Reviewed
- src/db/schema.ts, drizzle/0028_* — column/migration
- src/lib/program-input.ts, src/db/programs.ts(+save/clone tests) — threading
- src/app/programs/new/program-draft.ts(+test), program-builder.tsx — editor
- src/lib/mcp/program-tools.ts — exposure + preservation note
- src/db/check-ins.ts, src/lib/check-in.ts(+test), check-in-card.ts(+test)
- src/app/api/cron/reminders/route.ts(+test) — rider
- src/app/check-in-card.tsx, page.tsx — home card
