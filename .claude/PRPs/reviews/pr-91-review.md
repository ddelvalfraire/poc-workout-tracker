# PR Review: #91 — feat: motion pass

**Reviewed**: 2026-07-18
**Author**: ddelvalfraire
**Branch**: feat/logger-motion → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Class-only motion additions plus one structural wrapper. Both utilities are
transform/opacity-only and every application is motion-safe gated, matching
the project's animation rules. The expanded-card wrapper refactor preserves
computed spacing (space-y-3 relocated, superset label compensated with mb-3).

## Findings

### CRITICAL / HIGH
None

### MEDIUM
None

### LOW
- Initial page load animates every card at once (section-level rise-in).
  Subtle at 180ms; if it reads as noisy in practice, scope the class to
  ADD_EXERCISE mounts via a state flag.
- Native dialog close is still instant (no exit animation) — exit motion for
  top-layer dialogs needs the allow-discrete/starting-style pattern; deferred
  deliberately to keep the diff small.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 87 files, 1287 tests |
| Build | Pass |

## Files Reviewed
- src/app/globals.css — Modified (rise-in, sheet-up utilities)
- src/app/workout/new/workout-logger.tsx — Modified (class additions + expanded-body wrapper)
- src/app/workout/new/{stats,exercise,plate,rest}-sheet.tsx — Modified (sheet-up class)
- src/components/session-conflict-dialog.tsx — Modified (sheet-up class)
