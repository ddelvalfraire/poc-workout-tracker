# Plan: Custom Exercises Phase 4b — Source-Aware Program Writes

## Summary
Thread the `(source, id)` composite exercise identity through every program **write** path: the `ProgramInput` validation boundary, `upsert_program` + program patch MCP tools, muscle tagging (`muscleRowsFor`), the prescription derives (`deriveDayPrescription`), day instantiation, and the web program builder. Fix the latent `supersetGroup` wipe on full replace in the same stroke (PRD-mandated ride-along). This unlocks Phase 5 (dogfood swap of the two live nearest-match slots).

## User Story
As a lifter with custom exercises, I want to place them into my training programs (via Claude/MCP or the web builder), so that programmed sessions, prescriptions, muscle volume, and history all track my real movements instead of nearest-match wger stand-ins.

## Problem → Solution
- `programExerciseSchema` can't express `source` or `supersetGroup` → full replace (`updateProgram`, MCP `upsert_program`, web edit save) resets customs to `'wger'` and **wipes superset groupings** → schema + insert learn both fields.
- `muscleRowsFor` only knows the wger catalog → customs get no muscle tags → merged per-user catalog keyed by composite.
- `deriveDayPrescription` pins `'wger'` (programs.ts:663–680) → composite-aware history reads.
- `instantiateProgramDay` omits `source` on the `workout_exercises` insert → a custom slot would log history under wger identity → copy it.
- Patch tools (`add_program_exercise`, `update_program_exercise`) are id-only → gain `source`.
- Web builder: picker already emits `PickedExercise.source` but `includeCustom` is off and the draft drops it → carry it through.

## Metadata
- **Complexity**: Large (cross-cutting, but every change follows an existing groove)
- **Source PRD**: `.claude/PRPs/prds/custom-exercises.prd.md`
- **PRD Phase**: 4b (MCP surface remainder) + web-builder unlock; Phase 5 dogfood follows
- **Estimated Files**: ~9 source + ~7 test files, split into **2 PRs**

## PR Split
- **PR 1 — server + MCP** (input schema, db writes/derives/instantiation, muscle tagging, MCP tools)
- **PR 2 — web builder unlock** (draft carries source + supersetGroup, `includeCustom` on)

Phase 5 (dogfood) is manual MCP-driven validation after deploy — not code.

---

## UX Design
Internal + MCP change for PR 1. PR 2: the program builder's picker shows the user's customs (labeled "Custom") and creating/keeping them in a program just works. No layout changes.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/program-input.ts` | 231–245 | `programExerciseSchema` to extend |
| P0 | `src/db/programs.ts` | 77–172 | `ExerciseCatalog`, `loadExerciseCatalog`, `muscleRowsFor`, `insertProgramChildren` |
| P0 | `src/db/programs.ts` | 636–710 | `DayForDerivation`, `deriveDayPrescription` ('wger' pins with Phase-4 comments) |
| P0 | `src/db/programs.ts` | 776–814 | `instantiateProgramDay` insert (missing `source`) |
| P0 | `src/db/program-patches.ts` | 316–437 | `ProgramExercisePatch`, `retagExerciseMuscles`, add/update exercise |
| P0 | `src/lib/mcp/program-tools.ts` | 43–137 | tool schemas + `toKgProgram` pass-through |
| P0 | `src/lib/mcp/program-patch-tools.ts` | 305–400 | add/update exercise tool inputs |
| P1 | `src/lib/mcp/write-tools.ts` | 14–19 | the existing optional-`source` arg pattern to mirror |
| P1 | `src/db/clone-program.test.ts` + `programs.ts:307–319` | — | clone already copies source/supersetGroup — the target invariant |
| P1 | `src/app/programs/new/program-draft.ts` | 50–60, 136–148, 407–507 | draft type, factory, both mappers (PR 2) |
| P1 | `src/app/workout/new/exercise-picker.tsx` | 55–70, 140–170 | `includeCustom` flag + `PickedExercise.source` (PR 2) |
| P2 | `src/lib/mcp/read-tools.ts` | 125–151 | customs→`Exercise`-shape mapping to reuse for the merged catalog |
| P2 | `src/db/custom-exercises.ts` | all | `listCustomExercises` (feeds merged catalog) |

## External Documentation
None needed — established internal patterns only.

---

## Patterns to Mirror

### OPTIONAL_SOURCE_ARG (MCP boundary)
```ts
// SOURCE: src/lib/mcp/write-tools.ts:16-18
// Composite identity: absent = 'wger' (the column default), so
// every existing caller keeps working unchanged.
source: z.enum(['wger', 'custom']).optional(),
```

### SCHEMA_DEFAULTED_SOURCE (db column)
```ts
// SOURCE: src/db/schema.ts:264-265
// 'wger' | 'custom' — exercise identity is the composite (source, id).
source: text('source').$type<ExerciseSource>().notNull().default('wger'),
```

### CLONE_COPIES_IDENTITY (the invariant full-replace must match)
```ts
// SOURCE: src/db/programs.ts:310-318 (cloneProgram)
.values({
  programDayId: pd.id,
  wgerExerciseId: exercise.wgerExerciseId,
  source: exercise.source,
  name: exercise.name,
  position: exercise.position,
  supersetGroup: exercise.supersetGroup,
  progression: exercise.progression,
})
```

### CUSTOM_ROW_TO_EXERCISE_SHAPE
```ts
// SOURCE: src/lib/mcp/read-tools.ts:137-146 (search merge)
.map((c) => ({ id: c.id, name: c.name, category: c.category,
  ...(c.muscles && c.muscles.length > 0 ? { muscles: c.muscles } : {}),
  ...(c.musclesSecondary && c.musclesSecondary.length > 0 ? { musclesSecondary: c.musclesSecondary } : {}) }))
```

### CATALOG_FAILURE_TOLERANCE
```ts
// SOURCE: src/db/programs.ts:85-92 — muscle tags are enrichment, not integrity;
// catalog fetch failure → save proceeds untagged. Preserve this per-source:
// a customs db failure must not block a save, and vice versa.
```

### COMPOSITE_MATCH_ON_ID_BASED_QUERY
```ts
// SOURCE: src/db/workouts.ts (getExerciseHistoryBefore) — "The query stays
// id-based … callers MUST match rows on (source, id)."
```

---

## Files to Change

### PR 1 — server + MCP
| File | Action | Justification |
|---|---|---|
| `src/lib/program-input.ts` | UPDATE | `programExerciseSchema` += `source` (default 'wger'), `supersetGroup` |
| `src/db/programs.ts` | UPDATE | merged catalog, `muscleRowsFor(source,…)`, insert both fields, unpin derives, instantiation copies `source` |
| `src/db/program-patches.ts` | UPDATE | patch/add gain `source`; retag on either identity half |
| `src/lib/mcp/program-tools.ts` | UPDATE | tool schemas += source/supersetGroup; pass-through; payload emits `source` |
| `src/lib/mcp/program-patch-tools.ts` | UPDATE | add/update exercise tools gain `source` |
| tests (save-program, program-patches, instantiate-program, program-tools, program-patch-tools, program-input if exists) | UPDATE | behavior coverage below |

### PR 2 — web builder
| File | Action | Justification |
|---|---|---|
| `src/app/programs/new/program-draft.ts` | UPDATE | draft carries `source` + `supersetGroup` through both mappers |
| `src/app/programs/new/program-builder.tsx` | UPDATE | `includeCustom` on; pass `source` from the pick |
| `src/app/workout/new/exercise-picker.tsx` | UPDATE | comment cleanup only (Phase-4 caveats now stale) |
| `src/app/programs/new/program-draft.test.ts` | UPDATE | round-trip preservation tests |

## NOT Building
- Delete for custom exercises (PRD: dodged until needed)
- Composite-aware `suggestFor` replace-ranking in the picker (exercise-replacement PRD)
- Superset **editing** UI in the web builder (draft only *preserves* groupings)
- `loggingType` on custom exercises / program slots (cardio PRD)
- Retro-linking existing wger history onto customs (provenance is a fact)
- `get_workout` plan-overlay `supersetGroup` omission (spike side-finding — separate incidental fix, not this PR)

---

## Step-by-Step Tasks (PR 1)

### Task 1: `programExerciseSchema` learns `source` + `supersetGroup`
- **ACTION**: In `src/lib/program-input.ts`, extend `programExerciseSchema`:
  - `source: z.enum(['wger', 'custom']).default('wger')` (default, not optional — `ProgramInput` consumers get a concrete value post-parse, mirroring `status`/`mesocycleWeeks` defaulting style)
  - `supersetGroup: z.number().int().min(0).nullable().optional()` (mirror the patch tool's bound `program-patch-tools.ts`)
- **GOTCHA**: `ExerciseSource` type lives in `src/db/schema.ts` (or wherever `write-tools` imports it from — check the import there); don't create a duplicate enum. Reuse a shared schema const if one exists in `custom-exercise-input.ts`.
- **VALIDATE**: `npx vitest run src/lib/program-input` (if a test file exists) + `tsc`.

### Task 2: Merged per-user catalog + composite `muscleRowsFor`
- **ACTION** in `src/db/programs.ts`:
  - `ExerciseCatalog` becomes `Map<string, Exercise>` keyed `` `${source}:${id}` ``.
  - `loadExerciseCatalog(userId: string)`: fetch wger (`getAllExercises`) and `listCustomExercises(userId)` in parallel — each source degrades independently (CATALOG_FAILURE_TOLERANCE). Map custom rows via CUSTOM_ROW_TO_EXERCISE_SHAPE.
  - `muscleRowsFor(programExerciseId, source: ExerciseSource, exerciseId: number, catalog)` looks up the composite key. Update all call sites (insertProgramChildren, program-patches ×3).
- **GOTCHA**: All four `loadExerciseCatalog` callers (`saveProgram`, `updateProgram`, `addProgramExercise`, `updateProgramExercise`) already have `userId` in scope. Keep the "network read stays outside the tx" comment/behavior.
- **VALIDATE**: existing save-program tests still green after mechanical updates; new test: a custom exercise in `ProgramInput` produces `program_exercise_muscles` rows from the custom's arrays.

### Task 3: `insertProgramChildren` persists `source` + `supersetGroup`
- **ACTION**: add both to the `programExercises` insert values (MIRROR: CLONE_COPIES_IDENTITY).
- **VALIDATE**: new tests — full save→`getProgramDetail` round-trip preserves `source: 'custom'` and `supersetGroup`; `updateProgram` (full replace) no longer wipes them.

### Task 4: Unpin the derives — `DayForDerivation` + `deriveDayPrescription`
- **ACTION**:
  - `DayForDerivation.exercises` += `source: ExerciseSource` (both real callers — `getProgramDayDetail` and `getProgramDetail` days — already select full rows, so this is type-tightening only).
  - Key `e1rmById`/`lastSetsById` by `` `${source}:${id}` `` composites; history filter becomes `r.source === exercise.source` (delete the two "'wger' pinned" comments — they promised this change); `getLastPerformance(userId, exercise.source, exercise.wgerExerciseId)`.
  - `ids` for `getExerciseHistoryBefore` stays the plain id list (COMPOSITE_MATCH_ON_ID_BASED_QUERY).
- **VALIDATE**: new test — two exercises sharing an integer id with different sources derive from separate histories (collision test, mirroring the Phase-2 collision tests).

### Task 5: `instantiateProgramDay` copies `source`
- **ACTION**: add `source: exercise.source` to the `workoutExercises` insert values.
- **GOTCHA**: this is the history-integrity linchpin for Phase 5 — a programmed custom must log under `('custom', id)`.
- **VALIDATE**: instantiate-program test — a day with a custom slot yields a workout exercise with `source: 'custom'`.

### Task 6: Patch layer — `source` on add/update
- **ACTION** in `src/db/program-patches.ts`:
  - `addProgramExercise` exercise param += `source?: ExerciseSource` (default `'wger'` at insert); tag via `muscleRowsFor(pe.id, source, id, catalog)`.
  - `ProgramExercisePatch` += `source?: ExerciseSource`. In `updateProgramExercise`: fetch catalog when `wgerExerciseId !== undefined || patch.source !== undefined`; retag with the **effective** identity — patch value ?? current row value (extend `findOwnedExercise`'s select, or read the row's `wgerExerciseId`/`source` inside the tx before update).
- **GOTCHA**: today retag only fires on `wgerExerciseId` change; a source-only change must also retag (identity changed). Keep `definedFields` semantics — omitted keys untouched.
- **VALIDATE**: program-patches tests — add with `source: 'custom'` tags from the custom's muscles; update flipping only `source` retags; update flipping only `wgerExerciseId` keeps current source for the retag lookup.

### Task 7: MCP `upsert_program` + payload
- **ACTION** in `src/lib/mcp/program-tools.ts`:
  - `toolExerciseSchema` += `source` (OPTIONAL_SOURCE_ARG pattern) and `supersetGroup: z.number().int().min(0).nullable().optional()`.
  - `toKgProgram` passes both through.
  - Program payload (`buildProgramPayload` exercises) emits `source` (next to `wgerExerciseId`, matching the composite-identity doc line in `search_exercises`); check `buildProgramDayView` (read-tools' shared day view) and add `source` there too if exercises appear.
  - Update `upsert_program` description: mention `source` per exercise + that supersets survive replace.
- **VALIDATE**: program-tools tests — upsert with a custom slot round-trips via `get_program` showing `source: 'custom'` and the `supersetGroup`.

### Task 8: MCP patch tools
- **ACTION** in `src/lib/mcp/program-patch-tools.ts`:
  - `add_program_exercise` inputSchema += `source` (optional enum), threaded to `addProgramExercise`.
  - `update_program_exercise` inputSchema += `source`; include in `isEmptyPatch` check + error message; thread to the patch.
  - Description updates (identity is composite; source defaults to 'wger').
- **VALIDATE**: patch-tool tests mirror the db-layer ones at the tool boundary (args reach the db fn).

### Task 9: PR 1 wrap
- Full validation (below), update PRD phase-4 row status, commit, PR, `/code-review`, merge.

## Step-by-Step Tasks (PR 2)

### Task 10: Draft carries identity
- **ACTION** in `program-draft.ts`:
  - `DraftProgramExercise` += `source: ExerciseSource` and pass-through `supersetGroup: number | null`.
  - `newDraftProgramExercise` accepts `source` from the pick; seeds `supersetGroup: null`.
  - `draftToProgramInput` emits both; `detailToProgramDraft` hydrates both.
- **GOTCHA**: `RESTORE_DRAFT` localStorage snapshots predate these fields — the restore validator (`program-draft.ts:305` area checks field types) must tolerate/default missing `source`/`supersetGroup` on old snapshots (default `'wger'`/`null`).
- **VALIDATE**: program-draft tests — detail→draft→input round-trip preserves `source: 'custom'` + `supersetGroup`; legacy snapshot restore defaults them.

### Task 11: Builder picker unlock
- **ACTION**: `program-builder.tsx` passes `includeCustom` to `ExercisePicker`; `newDraftProgramExercise(exercise)` now receives the pick's `source`. Delete/update the stale "can't express source until Phase 4" comments in `exercise-picker.tsx` (lines ~60–64) — do NOT touch the `suggestFor` comment (that's exercise-replacement scope).
- **VALIDATE**: `npm run build`; manual: builder search shows a custom, add it, save, reopen edit — still custom.

### Task 12: PR 2 wrap + PRD
- Full validation, PRD update (4b complete; builder unlock noted), commit, PR, `/code-review`, merge.

## Phase 5 (post-merge, post-deploy — manual via MCP)
1. `vercel deploy --prod` (deploys are manual — memory rule).
2. Via `mcp__workout-tracker__*`: verify the two customs exist (`search_exercises`) or create Cable Face Pull + Kneeling Cable Crunch with proper muscle tags (`create_custom_exercise`).
3. `get_program` on the live program → find the Upper-day Face Pulls and Legs-day Cable Crunch slots (day/exercise positions).
4. `update_program_exercise` each slot with `{wgerExerciseId: <customId>, source: 'custom', name}` — granular tools only, never `upsert_program` on the live block.
5. Verify: `get_program` shows `source: 'custom'` + retagged muscles; `preview_program_week` derives; instantiate + `get_last_performance(source: 'custom')` after the next logged session.
6. Mark phase 5 + PRD complete.

---

## Testing Strategy

| Test | Input | Expected | Edge? |
|---|---|---|---|
| parse defaults | exercise without `source` | `source: 'wger'` post-parse | back-compat |
| save round-trip | program w/ custom + supersetGroup | detail returns both | core |
| full replace preserves | `updateProgram` same input | no wipe of source/supersetGroup | regression (the bug) |
| custom muscle tagging | custom w/ muscles arrays | `program_exercise_muscles` rows, primary-wins dedup | core |
| catalog degrade | customs db throws | wger slots still tagged, save succeeds | resilience |
| derive collision | custom id == wger id in one day | separate e1RM anchors / lastSets | collision |
| instantiate | day w/ custom slot | workout exercise `source: 'custom'` | linchpin |
| patch add | `source: 'custom'` | insert + custom tags | core |
| patch update source-only | flip source | retag from other catalog side | edge |
| tool pass-through | upsert/add/update args | db fns receive source | boundary |
| draft round-trip | detail→draft→input | both fields survive | PR 2 |
| legacy snapshot | draft without new fields | restores with defaults | PR 2 |

## Validation Commands
```bash
npx tsc --noEmit                 # EXPECT: clean
npx vitest run                   # EXPECT: all green (1074+ baseline)
npx eslint src                   # EXPECT: clean
npm run build                    # EXPECT: clean production build
```

## Acceptance Criteria
- [ ] MCP: create custom → `upsert_program`/`add_program_exercise` with it → instantiate → log → `get_last_performance(source:'custom')` returns it (the PRD phase-4 success signal, now including program placement)
- [ ] `updateProgram`/`upsert_program` full replace preserves `supersetGroup` and `source`
- [ ] Web builder can add a custom and a web edit no longer strips groupings
- [ ] All validation commands pass; no regressions

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `ExerciseCatalog` key change misses a call site | Low | tags silently missing | tsc catches signature change; grep `muscleRowsFor`/`loadExerciseCatalog` after |
| Old localStorage drafts crash restore | Med | builder unusable for user | Task 10 gotcha — tolerant restore w/ defaults |
| `source` default interacting with `definedFields` patch semantics | Low | unintended retags | explicit tests for omitted vs provided |
| MCP zod/SDK optional-enum quirks | Low | tool arg rejected | mirror the exact `write-tools.ts` pattern already shipped in 4a |

## Notes
- `getExerciseHistoryBefore` stays id-based by documented design; composite matching is the caller's job.
- `program-stats.ts:209` already handles `source` — no change.
- `cloneProgram` already copies both fields — it's the reference implementation for the insert values.
