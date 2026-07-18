# PR Review: #72 — feat: source-aware program writes — customs become programmable

**Reviewed**: 2026-07-17
**Author**: ddelvalfraire
**Branch**: feat/custom-exercises-program-writes → main
**Decision**: APPROVE (LOW finding fixed pre-merge)

## Summary
Composite `(source, id)` identity threaded through every program write path (input schema, catalog/tagging, derives, instantiation, patch layer, MCP tools, substitute actions). Independent reviewer verified every call site keys on the composite — no collision path remains — and that omitted `source`/`supersetGroup` behave exactly as before (schema defaults, `undefined`-only patch semantics, non-nullable enum at the MCP boundary). The per-source catalog degrade is a strict improvement: previously one wger outage untagged everything.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
1. **No direct test for `updateProgram`'s id-present replace branch** — `insertProgramChildren` is shared with `saveProgram` (which is covered), so transitively exercised, but the replace branch had no direct pin. **Fixed pre-merge**: `save-program.test.ts` now runs `updateProgram` with a custom + supersetted slot and asserts both fields survive the re-insert.

## Validation Results

| Check | Result |
|---|---|
| Type check (tsc --noEmit) | Pass |
| Lint (eslint src) | Pass |
| Tests | Pass — 74 files / 1091 tests (17 new this PR) |
| Build (next build) | Pass |

## Files Reviewed
- `src/lib/program-input.ts` — Modified (source/supersetGroup on programExerciseSchema, ProgramInputUnparsed)
- `src/db/programs.ts` — Modified (merged catalog, composite muscleRowsFor, insert both fields, unpinned derives, instantiation stamps source)
- `src/db/program-patches.ts` — Modified (source on add/update, effective-identity retag)
- `src/lib/mcp/program-tools.ts` — Modified (tool schemas, pass-through, payload emits source)
- `src/lib/mcp/program-patch-tools.ts` — Modified (source on add/update tools)
- `src/app/workout/actions.ts` — Modified (composite slot matching in substitute actions)
- `src/lib/substitute-slot.ts` — Modified (source on SlotForSubstitution)
- `src/app/programs/new/program-draft.ts` — Modified (payload retyped to pre-parse input)
- Tests: save-program, program-patches, instantiate-program, program-tools, program-patch-tools, program-input, substitute-slot — Modified
