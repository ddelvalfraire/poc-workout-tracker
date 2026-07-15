# Plan: Custom Exercises — Phase 2: Source-Aware Drafts + Identity Plumbing

## Summary
Thread `source: 'wger' | 'custom'` through the logger pipeline (draft type → payload codec → workout-input → save/update) and fix the composite-identity gaps: `getLastPerformance`, `getExerciseHistoryBefore`, and the three logger-facing actions (`getLastPerformanceAction`, `getExerciseSheetAction`, `getExerciseBestAction`) plus the logger's query keys, sheet link, and PR-detection baseline. The loggingType rollout is the exact template at every layer (additive, optional-on-the-wire, 'wger' default — no payload version bump).

## Metadata
Complexity: Large-ish Medium · Source PRD: custom-exercises.prd.md (Phase 2) · Files: ~10

## Template precedent (loggingType, verified)
- Codec: `isDraftExercise` allows absent-or-valid; `parseDraftPayload` defaults on restore (draft-payload.ts:64-79).
- Input: optional field, validated, spread-if-valid (workout-input.ts:172-183).
- Save: mapped in `saveWorkout`/`updateWorkout` row build (workouts.ts:169 area).
- Validator: `exerciseSourceSchema` already exists (custom-exercise-input.ts:33).

## Tasks
1. **Draft type** — `DraftExercise.source: ExerciseSource` (required in state); `newDraftExercise` / `replacementDraftExercise` accept source (picker passes 'wger' until Phase 3); `detailToDraft` reads it off the workout detail (relation select includes the column).
2. **Codec** — `isDraftExercise` accepts absent-or-valid source; restore defaults 'wger'. NO version bump (additive-with-default, loggingType precedent).
3. **workout-input** — optional `source` on the exercise shape, validated against 'wger'|'custom'; `saveWorkout`/`updateWorkout` persist it (column default keeps old clients at 'wger').
4. **db/workouts** — `getLastPerformance(userId, source, wgerExerciseId, exclude?)` composite filter; `getExerciseHistoryBefore` returns `source` per row (query stays id-based; CALLERS match composite). Callers: workout actions; MCP read-tool passes explicit `'wger'` (comment: source arg lands Phase 4); `deriveDayPrescription` (programs.ts:675) passes the program exercise's source; history-before consumers (programs.ts:654 map key, workout/[id]/page.tsx prior-best grouping) key on `${source}:${id}`.
5. **Actions** — the three logger actions gain a validated `source` param (default 'wger'); types re-exported as before.
6. **Logger** — draft exercises carry source; last-performance/best/sheet query keys + calls include it; `StatsSheet` gets a `source` prop and links `exerciseHref({ source, ... })`; PR-detection baseline map keyed `${source}:${id}`; planTargets lookups stay id-keyed (program days can't hold customs until Phase 4 — noted, not widened).
7. **Tests** — codec absent/invalid source; input validation; save mapping; composite collision tests for getLastPerformance; action param validation; derive/instantiate mocks updated only where signatures break.

## NOT in this phase
Picker create UI / merged search (Phase 3); MCP source args (Phase 4); planTargets/day-detail composite keys (unreachable until Phase 4 — documented).

## Validation
npm test · eslint changed files · build. No migration (columns exist).
