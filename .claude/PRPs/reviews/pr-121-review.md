# PR Review: #121 — feat: body measurements + unified /body page

**Reviewed**: 2026-07-31
**Author**: ddelvalfraire
**Branch**: feat/body-measurements → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Faithful echo of the proven bodyweight pattern with sensible divergences
(no denorm current value → no transaction, documented). Boundaries held:
site whitelist + 10–300 cm band enforced at the db seam with a thin
semantic guard at the action; ownership via delete…returning; cm canonical
with display derived from the one existing unit preference (no settings
sprawl). The fold preserves deep links (308) and the bodyweight islands
moved unmodified — no behavior drift. Site-picker doubling as chart
selector and form input is the right 320px call.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- No MCP exposure yet (coach can't see measurements) — deferred to 3b/3c
  as noted.
- List cap 120 mirrors bodyweight's cap idiom; pagination if history ever
  matters.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 111 files, 1695 tests (29 new) |
| Build | Pass (/body + /bodyweight redirect both emit) |
| Migration | Generated only (0026); apply at deploy |

## Files Reviewed
- src/db/schema.ts, drizzle/0026_* — table/migration
- src/db/body-measurements.ts(+test) — validated, ownership-scoped layer
- src/lib/units.ts(+test), measurement-sites.ts — canonical-unit discipline
- src/app/body/* — folded page + measurements section
- src/app/bodyweight/page.tsx — permanentRedirect
- src/app/actions.ts(+test), settings link
