# PR Review: #105 — feat: standalone workout templates

**Reviewed**: 2026-07-19
**Author**: ddelvalfraire
**Branch**: feat/workout-templates → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Sketch-not-program modeling is the right cut (no per-set table, documented),
and the sharing-ready shape aligns with the proposals surface (authorActor
open value space, no ACLs). Boundaries verified: derivation output re-runs
the parse trust boundary before persist (caps, whitelists, positive-id CHECK
mirrored in schema); all db access ownership-scoped; uuid shape guards on
action ids; start-from-template creates no rows until save and follows the
existing ?from= repeat mechanics plus the single-active-session guard.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- No MCP surface yet (deliberate scope cut, tracked) — the coach can't see
  templates until then.
- Template exercises denormalize the name at save time; a later exercise
  rename won't back-propagate — consistent with workout_exercises' existing
  denormalization.
- Home shortcut grid reflow (3-up → 2×2) is a visual change beyond templates
  proper; small and justified at 320px.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 96 files, 1476 tests (31 new) |
| Build | Pass (new /templates routes) |
| Migration | Generated only (0022, additive); apply via db:migrate at deploy |

## Files Reviewed
- src/db/schema.ts(+test), drizzle/0022_* — tables/migration
- src/lib/template-input.ts(+test), workout-template.ts(+test) — trust boundary, derivation/seeding
- src/db/workout-templates.ts(+test) — scoped data access
- src/app/templates/* — list/detail/actions
- src/app/workout/[id]/workout-actions.tsx, workout/new/page.tsx, page.tsx — save/start/home wiring
