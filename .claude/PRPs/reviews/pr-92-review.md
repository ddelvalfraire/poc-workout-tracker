# PR Review: #92 — feat: skip exercises + workout/exercise notes

**Reviewed**: 2026-07-18
**Author**: ddelvalfraire
**Branch**: feat/skip-and-notes → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Full vertical (schema → validation → reducer → offline payload → UI → summary)
with 19 new tests. Security-sensitive surfaces verified: parseNotes is
string-only, trimmed, blank-omitted, >2000 rejected (reject-don't-truncate,
matching parseName); skipped requires a genuine boolean; all persistence goes
through drizzle parameterized queries; migration 0019 is additive-with-defaults
so existing rows and pre-notes offline payloads are unaffected.

## Findings

### CRITICAL / HIGH
None

### MEDIUM
None

### LOW
- Summary-page totalSets/volume still count typed-but-uncompleted sets on
  skipped exercises — pre-existing behavior for any uncompleted set, scoring
  correctly excludes them; acceptable.
- MCP tools don't expose notes/skipped yet — deliberate scope cut, tracked.
- Skipped exercises with all sets completed render as Skipped (skip wins over
  done-collapse) — correct precedence, noted for awareness.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 87 files, 1306 tests (19 new) |
| Build | Pass |
| Migration | Generated only (0019, 3 additive ALTERs); apply via db:migrate at deploy |

## Files Reviewed
- src/db/schema.ts, drizzle/0019_* — Added columns/migration
- src/lib/workout-input.ts(+test) — parseNotes/skipped validation
- src/app/workout/new/workout-draft.ts(+test) — draft fields, 3 actions, state spread fix
- src/app/workout/new/draft-payload.ts(+test) — backward-compatible payload
- src/db/workouts.ts — persistence threading
- src/app/workout/new/workout-logger.tsx — rail buttons, skipped fold, notes UI
- src/components/ui/textarea.tsx — Added
- src/app/workout/[id]/page.tsx — notes + Skipped chip
