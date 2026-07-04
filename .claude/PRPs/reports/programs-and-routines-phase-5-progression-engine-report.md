# Implementation Report: Progression Engine + Techniques (Programs Phase 5)

## Summary
Built the Phase-5 power-user tier: a pure progression engine (`src/lib/progression.ts`) with an RTS-style RPE→%1RM chart and week-N derivation for all five schemes plus the deload modifier; wger-derived muscle tagging (`program_exercise_muscles`); per-week set overrides (`program_set_overrides`) with merge-then-revalidate ops and MCP tools; superset grouping; history-derived week auto-detection; engine-driven instantiation; and a `preview_program_week` dry-run tool with per-set `derivedFrom` attribution and volume-per-muscle.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | XL (~18 files, 14 tasks) | XL — 20 files changed across 4 commits |
| Confidence | 8/10 | Held — one engine design gap surfaced (see deviations), fixed inside the phase |
| Files Changed | ~18 (7 new, 11 updated) | 20 (5 new, 15 updated) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | RPE→%1RM chart | Done | Implemented as the rep-max curve read on the reps+RIR diagonal (identical values, single array + interpolation) |
| 2 | Week-N derivation engine | Done | + `applyOverride` and `sourceIndex` (deviations below) |
| 3 | Schema additions | Done | TDD via `getTableConfig` assertions |
| 4 | Migration 0005 | Done | Generated as-is (no hand edit needed); applied to dev DB |
| 5 | wger muscles parse | Done | `name_en` fallback covered |
| 6 | Zod tightening + `setOverrideSchema` | Done | Cross-field rules via union-level `superRefine` as planned |
| 7 | Muscle tagging on write | Done | Catalog pre-fetched outside tx; failure → untagged save |
| 8 | Override ops | Done | Select-then-update/insert instead of `onConflictDoUpdate` (deviation) |
| 9 | Week auto-derive | Done | `nextProgramWeek(userId, programId, mesocycleWeeks)` (deviation: extra param) |
| 10 | Engine-driven instantiation | Done | `instantiateProgramDay` returns `{ id, week, weekDerived }` |
| 11 | `get_program` enrichment + auto-week | Done | Payload: muscles, supersetGroup, per-set overrides (display units) |
| 12 | Override + superset tools | Done | `set_program_set_override`, `remove_program_set_override`, `supersetGroup` arg |
| 13 | `preview_program_week` | Done | `derivedFrom` per set, volume per primary muscle, auto-week default |
| 14 | Docs touch-ups | Done | Module headers + PRD updated |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `tsc --noEmit` + eslint clean on all touched files |
| Unit Tests | Pass | 472 total (74 new this phase) across 35 files |
| Build | Pass | `next build` compiles |
| Integration | N/A | MCP tools covered by handler tests; manual dogfood pending |
| Edge Cases | Pass | Empty history, null bases, week clamping, deload+warmups, all-null override deletion, catalog failure |

## Files Changed

| File | Action |
|---|---|
| `src/lib/progression.ts` (+ test) | CREATED — engine, chart, `applyOverride` |
| `drizzle/0005_optimal_blur.sql` + meta | CREATED — two tables + `superset_group` |
| `src/db/schema.ts` (+ test) | UPDATED — `program_exercise_muscles`, `program_set_overrides`, `supersetGroup`, `$type` on set enums |
| `src/lib/wger.ts` (+ test) | UPDATED — muscles/muscles_secondary parse |
| `src/lib/program-input.ts` (+ test) | UPDATED — progression bounds, `setOverrideSchema`, type exports |
| `src/db/programs.ts` | UPDATED — catalog/tagging, `nextProgramWeek`, `deriveDayPrescription`, engine-driven `instantiateProgramDay`, enriched detail reads |
| `src/db/program-patches.ts` (+ test) | UPDATED — override ops, supersetGroup, retag-on-swap |
| `src/db/save-program.test.ts`, `src/db/instantiate-program.test.ts` | UPDATED — tagging + engine cases |
| `src/lib/mcp/program-tools.ts` (+ test) | UPDATED — payload enrichment, auto-week instantiate, `preview_program_week` |
| `src/lib/mcp/program-patch-tools.ts` (+ test) | UPDATED — override tools, supersetGroup arg |
| `src/lib/mcp/tools.test.ts`, `read-tools.test.ts`, `resources.test.ts` | UPDATED — inventory + fixture shapes |

## Deviations from Plan
1. **RPE chart storage**: stored as ONE rep-max percent array read on the reps+RIR diagonal (with half-step interpolation) instead of a 2D `rpe*2`-keyed map — identical values, less duplication. The plan's `12@6 ≈ 0.574` expectation was a hand-calc error (doubled the RIR); the correct chart value is `0.626` and the test asserts it.
2. **`applyOverride` lives in the engine** (`progression.ts`), not the db layer — the merge is pure, and sharing it guarantees preview and instantiation can never disagree.
3. **`DerivedSet.sourceIndex` added**: overrides key on template sets, but weekly-volume/deload resize and renumber the derived list; `sourceIndex` preserves the mapping. The plan missed this.
4. **`nextProgramWeek` takes `mesocycleWeeks`** as a third param (callers already hold the program row — saves a read); week auto-derivation folded into `instantiateProgramDay` rather than the tool layer.
5. **Override upsert** implemented as select-then-update/insert inside the tx instead of `onConflictDoUpdate` — matches the existing chain-recording test harness and read-merge-validate flow.
6. **Tool-layer instantiate adaptation landed in commit C** (not D) to keep every commit group type-clean, since the db return shape changed.

## Issues Encountered
- Pre-existing tests let `saveProgram` reach the real wger fetch once tagging was added — masked by `loadExerciseCatalog`'s catch. Fixed by mocking `@/lib/wger` (and `loadExerciseCatalog` in the patch harness) so no test can touch the network.

## Tests Written

| Test File | New/Updated Tests | Coverage |
|---|---|---|
| `src/lib/progression.test.ts` | 30 | chart values/interpolation/bounds, all 5 schemes, deload, clamping, warmups, negative loads, `applyOverride` |
| `src/db/schema.test.ts` | +4 | new tables, uniques, nullability |
| `src/lib/wger.test.ts` | +3 | muscles parse, `name_en` fallback, malformed entries |
| `src/lib/program-input.test.ts` | +6 | progression bounds, cross-field rules, `setOverrideSchema` |
| `src/db/save-program.test.ts` | +3 | tagging, unknown id, catalog failure |
| `src/db/instantiate-program.test.ts` | 13 (rewritten) | engine seeding per scheme, overrides, auto-week, `nextProgramWeek` |
| `src/db/program-patches.test.ts` | +11 | override upsert/merge/clear/integrity, retag, supersetGroup |
| `src/lib/mcp/program-tools.test.ts` | +5 | payload enrichment, preview, auto-week echo |
| `src/lib/mcp/program-patch-tools.test.ts` | +7 | override tools, lazy unit, verbatim errors, supersetGroup |

## Next Steps
- [ ] Manual dogfood via MCP (author a linear+deload program → preview weeks 1/3/deload → override → instantiate with auto-week)
- [ ] `/code-review` then `/prp-pr`
- [ ] Phase 6 (Web UI) is the last pending PRD phase
