# PR Review: #32 — feat: per-set rest targets through the engine, live countdown

**Reviewed**: 2026-07-08
**Author**: ddelvalfraire
**Branch**: feat/rest-timer-targets → main
**Decision**: APPROVE

## Summary
Reviewer ran the suite in an isolated worktree and traced every engine branch point: DerivedSet passthrough (incl. weekly-volume resize-clone inheritance), override `restSec: 0` semantics (`!== null`, not truthy), deload leaving rest untouched, 0..3600 bounds consistent across input schema / MCP args / action / prefs corrupt-guard, null-to-clear on update/override verified with tests, countdown math + formatElapsed plausibility ceiling, value-bearing aria-labels, dialog close() in cleanup, draft-codec legacy tolerance, MCP payload surfacing. No behavioral, validation, or security findings. (Settings-page commit bf5702e landed after the review snapshot; it reuses reviewed controls and the reviewed RestSheet.)

## Findings

### CRITICAL / HIGH
None

### MEDIUM
- Deploy-order dependency: new code selects the new columns unconditionally — migration must run before deploy. Acknowledged in the PR body; enforced operationally (migrate step precedes `vercel --prod` in the release run).

### LOW
- `MAX_REST_SEC`/`MAX_STORED_REST_SEC` deliberately duplicated (db layer stays free of input-boundary imports); both sides tested. Accepted.

## Validation

| Check | Result |
|---|---|
| Type check / Lint / Build | Pass |
| Tests | Pass (804) |

## Files Reviewed
progression.ts, rest-target.ts, program-input.ts, preferences.ts, program-patches.ts, programs.ts, actions.ts, session-clock.tsx, rest-sheet.tsx, workout-logger.tsx, edit/page.tsx, program-draft.ts, mcp program tools, drizzle/0010.
