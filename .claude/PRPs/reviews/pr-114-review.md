# PR Review: #114 — feat: program-day weekday schedule + up-next anchor

**Reviewed**: 2026-07-30
**Author**: ddelvalfraire
**Branch**: feat/program-day-schedule → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The timezone decision is the load-bearing one and it's right: the anchor is
computed client-side after mount (existing mounted pattern), SSR renders the
neutral pre-schedule literal, so "Today" can never be wrong for the device's
local day and unscheduled programs render byte-identically (they never mount
the client component). Validation rejects padded input before dedupe;
edit round-trip proven so saves can't wipe schedules; cloneProgram's
explicit column list gained the field (it would otherwise have silently
dropped it — caught by the agent); truth table covers Sunday wrap and
nearest-of-many.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- MCP add_program_day doesn't take weekdays yet (default '{}' keeps
  agent-added days unscheduled) — deliberate scope cut; small follow-up.
- Anchor label replaces the literal in the hydration frame — a one-frame
  swap on scheduled programs; imperceptible, noted.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 1602 tests (14 new) |
| Build | Pass |
| Migration | Generated only (0024, additive int[] default '{}'); apply at deploy |

## Files Reviewed
- src/db/schema.ts, drizzle/0024_* — column/migration
- src/lib/program-input.ts(+test) — validation
- src/db/programs.ts(+save/clone/next tests) — persist, clone carry, NextProgramDay
- src/lib/schedule-anchor.ts(+test), src/app/up-next-anchor.tsx — anchor
- src/app/programs/new/program-draft.ts(+test), program-builder.tsx — picker
- src/app/next-workout-card.tsx, workout/[id]/finish-up-next-card.tsx — hero wiring
- src/lib/mcp/program-tools.ts — upsert/get carry
