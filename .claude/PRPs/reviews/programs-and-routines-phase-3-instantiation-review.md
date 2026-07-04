# Code Review: Programs & Routines — Phase 3 (Instantiation)

**Reviewed**: 2026-06-28
**Branch**: feat/programs-phase-1-schema (local, uncommitted)
**Mode**: Local Review
**Decision**: APPROVE with comments

## Summary
Phase 3 adds `instantiate_program_day` (program day → dated workout, seeded loads + provenance) and the `get_workout`/`workout://{id}` plan overlay. An independent `code-reviewer` pass verified all six invariants (ownership gate, seed correctness, no targets in the sets row / no overlay drift, conditional + user-scoped program query, no import cycle, tool guard order). No CRITICAL or HIGH. One MEDIUM (documented) + two LOW (fixed).

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
1. **TOCTOU — ownership read outside the transaction** (`src/db/programs.ts`). A concurrent `delete_program` in the window between `getProgramDayDetail` and the workout insert makes the insert fail the `program_day_id` FK, genericized to "MCP tool failed" rather than a clean not-found. Low probability for a single-user POC; the plan already accepted it. **DOCUMENTED**: added a comment on `instantiateProgramDay` explaining the window and the revisit path (tx-scoped read + row lock). A read-inside-tx without row locks would give false safety, so deferred deliberately.

### LOW
1. **Dead `| null` arm on `plan`** (`src/lib/mcp/read-tools.ts`). `buildWorkoutPayload` omits the `plan` key rather than emitting `null`, so `plan?: ProgramDayView | null` was misleading. **FIXED** → `plan?: ProgramDayView`.
2. **Misleading guard message** (`src/lib/mcp/program-tools.ts`). `assertProgramIdShape` says "Program …" for a program *day* id, clashing with the tool's own "Program day … not found". **FIXED** → added `assertProgramDayIdShape` (day-scoped message) + a unit test; `instantiate_program_day` now uses it.

### Noted (not a defect)
- A zero-exercise program day instantiates to a childless workout — sensible, consistent with an ad-hoc empty workout.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint src`) | Pass |
| Tests (`vitest run --exclude worktrees`) | Pass (326; +13 this phase incl. the 2 review-fix tests) |
| Build (`next build`) | Pass |

## Files Reviewed
- `src/db/programs.ts` — Modified (`getProgramDayDetail`, `instantiateProgramDay`; TOCTOU comment added)
- `src/db/instantiate-program.test.ts` — Added
- `src/lib/mcp/program-tools.ts` — Modified (tool + overlay projection; uses `assertProgramDayIdShape`)
- `src/lib/mcp/program-id.ts` — Modified (added `assertProgramDayIdShape`)
- `src/lib/mcp/program-id.test.ts` — Modified (+2 tests)
- `src/lib/mcp/read-tools.ts` — Modified (overlay; `plan?: ProgramDayView`)
- `src/lib/mcp/resources.ts` — Modified (workout resource overlay)
- `src/lib/mcp/{program-tools,read-tools,resources,tools}.test.ts` — Modified (coverage + tool list)
