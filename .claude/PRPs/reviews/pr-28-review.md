# PR Review: #28 — feat: card personality pass, gear pill editor, hide bodyweight on home

**Reviewed**: 2026-07-08
**Author**: ddelvalfraire
**Branch**: feat/card-personality-pass → main
**Decision**: REQUEST CHANGES → resolved (both MEDIUM findings fixed in-branch)

## Summary
Cohesive, well-scoped visual pass. Date/Intl usage, ARIA wiring (aria-pressed pills, progressbar semantics, fieldset/legend), volt-accent discipline, truncation at narrow widths, and the bodyweight-removal regression check all verified sound. Two MEDIUM findings, both fixed before merge.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
- **[FIXED]** New pure logic (`parseCustomWeight`, `toggleValue`, `pillOptions`, save guard) shipped untested. Helpers exported; `plate-sheet.test.ts` added (8 tests: parse valid/zero/negative/non-numeric/whitespace, toggle add/remove/no-mutation, union dedup + sort).
- **[FIXED]** Gear pills were ~28–30px tall — under the 44px thumb-target guidance for what is now the primary gear-selection surface. All sheet pills (gear editor AND bar picker, one vocabulary) bumped to `min-h-11 px-4`; the custom input and Add button aligned to the same height.

### LOW
- Custom pill vanishes from the list when deselected (selected = owned by design) — documented with a code comment; accepted product behavior.
- Pill/input height mismatch in the custom-add row — resolved by the touch-target fix.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass (0 warnings) |
| Tests | Pass (748, 8 new) |
| Build | Pass |

## Files Reviewed
src/app/page.tsx, src/app/programs/page.tsx, src/app/programs/[id]/page.tsx, src/app/programs/[id]/program-actions.tsx, src/app/next-workout-card.tsx, src/app/resume-session-card.tsx, src/app/workout/[id]/page.tsx, src/app/workout/new/plate-sheet.tsx (+ new plate-sheet.test.ts), with supporting reads of db/workouts.ts, lib/active-session.ts, lib/format.ts, components/ui/button.tsx.
