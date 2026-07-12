# Code Review: Start any week + provenance visibility (fix/start-any-week)

**Reviewed**: 2026-07-11
**Branch**: fix/start-any-week (local, pre-commit)
**Reviewer**: typescript-reviewer agent + validation suite
**Decision**: APPROVE (initial BLOCK resolved in-session)

## Summary
Program page now starts any untouched day of the selected week (explicit week stamping), and the logger surfaces the immutable "Day · Week N" provenance stamp. The reviewer's one HIGH finding — unbounded explicit week — was fixed TDD-style before commit.

## Findings

### CRITICAL
None.

### HIGH
- `actions.ts` / `db/programs.ts` — the explicit `week` was validated only for `>= 1`; a forged/tampered POST (server actions are public endpoints) could stamp `week: 999999`, permanently poisoning `nextProgramWeek`'s `max(programWeek)` read and the "Week X of Y" header. The gap technically pre-dated this branch (MCP `instantiate_program_day` had the same unbounded schema), but this branch removed the "explicit weeks are MCP-only" trust boundary, making it reachable from ordinary UI. **Fixed**: `instantiateProgramDay` now rejects an explicit week outside `1..mesocycleWeeks` after the ownership read (data-layer backstop covers web action AND MCP); 2 new tests (RED→GREEN) in `instantiate-program.test.ts`.

### MEDIUM
- No test covered out-of-range explicit weeks. **Fixed** by the same two tests.

### LOW
None — JSX restructuring (Skipped tag, collapse removal), `programContext` plumbing, and a11y all verified clean.

## Considered, deferred
- Defense-in-depth clamp of `nextProgramWeek`'s non-advancing branch: skipped — the stats layer deliberately tolerates observed overshoot (weeks array = max(mesocycle, observed)), and the new instantiation guard blocks fresh garbage at the source. Revisit only if legacy out-of-range rows surface.

## Validation Results (post-fix)

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass — 895/895 (2 new) |
| Build | Pass |

## Files Reviewed
- `src/app/programs/actions.ts` — Modified (week param)
- `src/app/programs/[id]/start-day-button.tsx` — Modified (week prop)
- `src/app/programs/[id]/page.tsx` — Modified (selected-week starts, Skipped tag)
- `src/app/workout/[id]/edit/page.tsx` — Modified (programContext)
- `src/app/workout/new/workout-logger.tsx` — Modified (programContext render)
- `src/db/programs.ts` — Modified (week range guard, review fix)
- `src/db/instantiate-program.test.ts` — Modified (2 new tests)
