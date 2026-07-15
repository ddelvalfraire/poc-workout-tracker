# Plan: Custom Exercises — Phase 3: Merged Catalog + Create/Edit UI

## Summary
Customs become pickable and creatable in the web UI: the picker merges the user's customs with the wger catalog (separate uncached fetch so the shared catalog stays browser-cacheable), a "Create '<query>'" escape hatch at the bottom of search results opens an inline form (name + required category + optional primary-muscle chips), and `/exercises/custom/[id]` gains an edit island. The logger's replace flow gates its plan-patch offers off custom picks (program inputs learn source in Phase 4).

## Metadata
Complexity: Large-ish Medium · Source PRD: custom-exercises.prd.md (Phase 3) · Files: ~9

## Key facts (verified)
- `customExerciseInputSchema` (name/category/equipment/muscles/musclesSecondary, strict) + `createCustomExercise`/`updateCustomExercise`/`listCustomExercises` all exist (Phase 1).
- Picker loads `/api/exercises?all=1` once, filters in-process; hosted by exercise-sheet (logger add/replace) AND program-builder — the latter must NOT see customs (program save path drops source until Phase 4).
- Caching: `all=1` stays wger-only + cacheable; a NEW `custom=1` branch returns the user's customs `no-store` (they change on create; per-user).
- Replace flow: `substitutePlanTargetsAction` + the remember offer both assume wger ids → skip both when `picked.source === 'custom'` (commented Phase-4 unlock).
- Muscle chips: `CATALOG_MUSCLE_NAMES` exported from lib/muscle-groups (the 15 mapped names) so created customs feed muscle-volume/replacement correctly.

## Tasks
1. `lib/muscle-groups.ts`: export `CATALOG_MUSCLE_NAMES` (NAME_TO_GROUP keys) + test line.
2. `api/exercises/route.ts`: `custom=1` → `listCustomExercises` mapped to the Exercise shape + `source: 'custom'`, `Cache-Control: no-store`.
3. `src/app/exercises/actions.ts` ('use server'): `createCustomExerciseAction(input)` / `updateCustomExerciseAction(id, input)` — requireUserId + schema parse + db call, `revalidatePath('/exercises')`; duplicate-name unique violation surfaced as a clear error. Tests (validation, delegation, dup mapping).
4. `exercise-picker.tsx`: `ExerciseResult.source`; `onAdd` payload gains `source`; `includeCustom?: boolean` (default false — program builder unchanged) fetches+merges customs; create row (query non-empty, includeCustom) → inline form (name prefilled, category select, muscle chips) → action → onAdd custom + local list insert; customs join name search and the alternatives rail naturally.
5. `exercise-sheet.tsx`: pass `includeCustom` through (true from logger usage).
6. `workout-logger.tsx`: picked types widen with `source`; `performReplace` skips substitute-targets + remember when custom; add paths already source-aware via factories.
7. `/exercises/[source]/[id]/page.tsx`: when custom, fetch the definition and render `CustomExerciseEditor` island (name/category/chips form → update action → router.refresh); wger pages unchanged.
8. PRD row 3 complete at merge.

## NOT in this phase
Program-builder customs, MCP tools, delete, secondary-muscle UI (schema supports; Phase 4 can set).

## Validation
npm test · eslint · build; manual: create from picker mid-session → logs/ghosts/sheet/stats all track the custom; edit renames it everywhere.
