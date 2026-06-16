# Code Review: feat/last-time-inline (branch vs main)

**Reviewed**: 2026-06-14
**Branch**: feat/last-time-inline → main
**Scope**: 27 source/test/migration files, ~1060 insertions (two features bundled: kg/lb unit preference + per-set "last time" ghost inputs)
**Decision**: APPROVE with comments

## Summary
Solid, defensively-written work. Clear trust boundaries (every action goes through `requireUserId` + user-scoped queries), parameterized DB access, immutable reducer, kg as canonical storage with display-only conversion, and good test coverage (108 unit tests + e2e). No security or correctness defects. Findings are limited to one stale comment, one easy perf win, and minor consistency/process notes.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1 — Incorrect JSDoc: `getWeightUnit` says "defaulting to kg", default is `lb`**
`src/db/preferences.ts:14`
> `/** Returns the user's weight unit, defaulting to kg when unset or unrecognized. */`

The actual fallback is `DEFAULT_WEIGHT_UNIT`, which is `'lb'` (`src/lib/units.ts:5`, schema column default `'lb'`). The comment contradicts the code and the product default. Comment rot — misleads the next reader about the unconfigured-user behavior.
*Fix*: change "defaulting to kg" → "defaulting to the product default (lb)".

**M2 — Sequential N+1 fetch of prior performance in the logger effect**
`src/app/workout/new/workout-logger.tsx:62-72`
The effect awaits `getLastPerformanceAction` one exercise at a time in a `for` loop, and each call issues two DB round-trips (`getLastPerformance`: recent-exercise query + sets query, `src/db/workouts.ts:62-90`). In edit mode a workout with N exercises serializes ~2N round-trips on mount. The reservation logic correctly prevents refetching, so this fires once — but the sequential awaits are an easy parallelization win.
*Fix*: `await Promise.all(missing.map(...))`, still updating state per-result. (Optional, but cheap and noticeable for multi-exercise edits.)

### LOW

**L1 — Function-level default `unit = 'kg'` diverges from product default `'lb'`**
`src/lib/format.ts:18,37`, `src/app/workout/new/workout-draft.ts:143,168`, `src/app/workout/new/workout-logger.tsx:38`
Every real caller passes an explicit `unit` (verified across all pages), so this is currently harmless. But the implicit `'kg'` fallback contradicts `DEFAULT_WEIGHT_UNIT='lb'`; a future caller that forgets to thread `unit` would silently render the wrong default. Consider importing `DEFAULT_WEIGHT_UNIT` as the parameter default, or dropping the default to force explicit passing.

**L2 — `getLastPerformanceAction` accepts negative/zero exercise ids**
`src/app/workout/actions.ts:71`
`Number.isInteger` admits `-1`, `0`. Harmless (no row matches, returns `null`), but a `> 0` check would match the strictness elsewhere in the validation layer.

**L3 — PR scope: two features bundled (~1060 lines)**
The branch carries both the unit-preference feature and the last-time-inline feature. Per the repo's "one ticket = one PR, under 300 lines" guideline this is large for a single review. Not a code defect — noting for merge strategy (the unit-preference commit `b94b22d` references #1, so part may already be reviewed upstream).

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint`) | Pass |
| Tests (`vitest`, 108) | Pass |
| Build (`next build`) | Pass |

## Notable strengths
- Authorization boundary is consistent: all reads/writes scoped by `userId`; `updateWorkout`/`deleteWorkout` use `... returning` as the ownership gate.
- kg stored canonically; lb conversion rounded only for display; entered weights bounded (`MAX_WEIGHT`) before the DB to avoid opaque numeric overflow.
- Loose `text` `unit` column read-guarded by `isWeightUnit` — never trusts stored data.
- Reducer is pure/immutable; id generation kept out of it for deterministic tests.
- Ghost-input edge cases handled (no history, fewer prior sets, blank prior field) and covered by e2e.
