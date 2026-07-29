# PR Review: #111 — feat: per-program plan-sync toggle

**Reviewed**: 2026-07-29
**Author**: ddelvalfraire
**Branch**: feat/plan-sync-toggle → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Faithful clone of the autoregulation toggle including its hardest-won
property: the input schema keeps planSync genuinely optional (no zod
default), updateProgram preserves the stored value on omission (test
asserts the column is absent from the update set), and the MCP description
states preserve-on-omit for both toggles. The gate reads the flag from the
helper's existing day fetch — zero added round-trips. Clone fidelity tested
against a non-default seed. Default true means new users get the fix with
no action.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- No narrow set_program_planSync MCP patch op (autoregulation has one) —
  flagged deviation, small follow-up if coach/MCP toggling is wanted.
- Old localStorage builder drafts lacking the field are dropped by the
  draft validator — same accepted behavior as when autoregulation shipped.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 100 files, 1585 tests (8 new) |
| Build | Pass |
| Migration | Generated only (0023, one additive column); apply via db:migrate at deploy |

## Files Reviewed
- src/db/schema.ts(+test), drizzle/0023_* — column/migration
- src/lib/program-input.ts(+test) — optional without default
- src/db/programs.ts(+save/clone tests) — create default, preserve-on-omit, clone carry
- src/lib/auto-plan-sync.ts(+test) — the gate
- src/app/programs/new/program-draft.ts(+test), program-builder.tsx — UI + round-trip
- src/lib/mcp/program-tools.ts — upsert/get exposure
