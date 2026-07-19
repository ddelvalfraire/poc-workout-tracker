# PR Review: #99 — fix: per-week set overrides survive program replace

**Reviewed**: 2026-07-19
**Author**: ddelvalfraire
**Branch**: fix/program-update-loss → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Verified the snapshot→wipe→re-attach runs entirely inside updateProgram's
transaction, carries every override column, keys by (day position, exercise
position, setNumber), and drops removed-slot overrides by design. Both write
paths (app UI and MCP upsert_program) share updateProgram, so one
implementation covers both. Investigation also invalidated the remembered
"wipes supersets" claim — supersets/source were already round-tripped and
test-pinned; stale doc comments corrected.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Reordering days/exercises shifts positions, so overrides follow the
  ADDRESS, not the movement — an edit that swaps two days keeps overrides on
  the position slots. Documented same-position semantics; acceptable for the
  coarse-replace contract this path implements.
- Snapshot runs one extra select per update even when re-attach short-
  circuits — negligible.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 90 files, 1353 tests (3 new) |
| Build | Pass |

## Files Reviewed
- src/db/programs.ts — snapshot/re-attach helpers + wiring; cloneProgram doc fix
- src/app/programs/actions.ts — stale loss comment removed
- src/lib/mcp/program-tools.ts — upsert description update
- src/db/save-program.test.ts, clone-program.test.ts — new coverage / rewording
