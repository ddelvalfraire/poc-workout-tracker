# Plan: Progression Engine + Techniques (Programs Phase 5)

## Summary
Build the power-user tier of the programs feature: a pure-function progression engine (linear, double-progression, %1RM, RPE-target, weekly-volume) with deload handling and an RPE→%1RM chart; per-week set overrides as the escape hatch for block/DUP models; muscle tagging derived from wger's muscles arrays (for volume-per-muscle math); superset grouping; auto-derived week tracking; and a dry-run `preview_program_week` tool. Instantiation stops seeding raw `suggestedLoadKg` and starts seeding week-N derived targets.

## User Story
As a hypertrophy lifter running a mesocycle through my agent, I want week-N sessions to start with progressed targets (and deloads to deload), so that I follow a real block without recomputing loads myself.

## Problem → Solution
Today `instantiate_program_day` seeds week 1's `suggestedLoadKg` verbatim for every week — `week` is a label, not an input to anything. → After this phase, week N instantiation derives loads/reps/set-counts from each exercise's `progression` JSONB + program `deloadWeek`, merges any explicit per-week overrides, tags exercises with muscles so weekly volume is SQL-computable, and auto-detects which week you're on.

## Metadata
- **Complexity**: XL (execute as ordered tasks; commit in the 4 groups marked below)
- **Source PRD**: `.claude/PRPs/prds/programs-and-routines.prd.md`
- **PRD Phase**: 5 — Progression engine + techniques
- **Estimated Files**: ~18 (7 new, 11 updated)

### Resolved open questions (user decisions — do not relitigate)
1. **Muscle taxonomy**: extend the wger parser to keep `muscles` / `muscles_secondary` (finer than category); denormalize onto a `program_exercise_muscles` relation at author time. Column/relation, never JSONB (PRD boundary rule).
2. **Multi-week storage**: derived week-N targets PLUS a `program_set_overrides` escape hatch — an override row (program_set × week) pins explicit targets that win over the engine.
3. **RPE math**: adopt an RTS-style RPE→%1RM lookup table as a pure function.
4. **Week tracking**: `instantiate_program_day` auto-derives the week from the program's own workout history; explicit `week` arg overrides.

---

## UX Design

N/A — MCP-surface change (the agent is the user). Interaction changes:

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| `instantiate_program_day` | `week` defaults to 1; seeds raw `suggestedLoadKg` | `week` auto-derived from history (override allowed); seeds engine-derived targets; response echoes `programWeek` + `weekDerived` | |
| `get_program` | days→exercises→sets | + `muscles`, `supersetGroup` per exercise; + `overrides` per set | |
| `upsert_program` / `add_program_exercise` / `update_program_exercise` | no muscle awareness | auto-tags muscles from the wger catalog on create and on `wgerExerciseId` change; `supersetGroup` arg | |
| NEW `set_program_set_override` / `remove_program_set_override` | — | pin/clear explicit targets for (set, week) | |
| NEW `preview_program_week` | — | dry-run: derived targets for every day at week N + sets-per-muscle counts, display units, no writes | |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/program-input.ts` | all (179) | `progressionSchema`/`techniqueSchema` to tighten; `programSetIntegrityViolation` sharing pattern |
| P0 | `src/db/programs.ts` | 213–275 | `instantiateProgramDay` — the function the engine plugs into |
| P0 | `src/db/program-patches.ts` | 1–175 | header contract, `Tx` type, finder/ownership helpers, `ProgramPatchError` channel, `definedFields` |
| P0 | `src/lib/mcp/program-patch-tools.ts` | 1–150 | arg schemas, `runOp`, `buildSetPatch` lazy-unit pattern, `isEmptyPatch` |
| P1 | `src/lib/wger.ts` | 38–120 | `Exercise`/`WgerExerciseInfo`/`mapExercise` — extend for muscles |
| P1 | `src/db/workouts.ts` | 52–118 | `getLastPerformance` (double-progression + e1RM inputs), `getExerciseHistoryBefore` |
| P1 | `src/lib/one-rep-max.ts` | all | `estimate1RM`, `bestSet` — reuse, don't duplicate |
| P1 | `src/db/schema.ts` | 96–200 | program tables + deferrable-unique precedent + relations block |
| P2 | `drizzle/0004_glamorous_vin_gonzales.sql` | all | hand-edited DEFERRABLE migration precedent |
| P2 | `src/db/program-patches.test.ts` | 1–60 | chain-recording DB mock harness |
| P2 | `src/lib/mcp/program-tools.ts` | 440–476 | `instantiate_program_day` tool to modify |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| RPE→%1RM chart | RTS/Tuchscherer chart (standard, widely reproduced) | %1RM = f(reps 1–12, RPE 6–10 in 0.5 steps); e.g. 5 reps @ RPE 8 ≈ 81%, 1 @ 10 = 100% |
| wger muscles | wger `/exerciseinfo` payload | each record has `muscles` and `muscles_secondary`: `[{ id, name, name_en, is_front }]`; `name_en` may be empty → fall back to `name` |

No other external research needed — everything else follows established internal patterns.

---

## Patterns to Mirror

### VALIDATION_SHARED_PREDICATE
```ts
// SOURCE: src/lib/program-input.ts:88-106 — export a pure rule function; Zod
// consumes it via superRefine, the DB layer via a thin assert that throws
// ProgramPatchError. New engine rules follow this exact split.
export function programSetIntegrityViolation(row: {...}): { path: ...; message: string } | null
```

### OWNERSHIP_FINDER
```ts
// SOURCE: src/db/program-patches.ts:144-166 — every op resolves its node through
// a join chain ending at eq(programs.userId, userId); null = not-found/not-owned.
async function findOwnedExercise(tx, userId, programId, dayPosition, exercisePosition)
```

### ERROR_CHANNELS
```ts
// SOURCE: src/db/program-patches.ts:33-34 + src/lib/mcp/program-patch-tools.ts:102-109
// null → tool throws ToolError('... not found for user ...');
// ProgramPatchError → runOp re-throws as ToolError with the message verbatim.
export class ProgramPatchError extends Error {}
async function runOp<T>(op: () => Promise<T>): Promise<T>
```

### MCP_TOOL_REGISTRATION
```ts
// SOURCE: src/lib/mcp/program-patch-tools.ts:170-194 — registerTool with title/
// description/inputSchema (raw zod map), handler resolves user, asserts id shape,
// wraps everything in try/catch → errorResult(error).
server.registerTool('add_program_day', { title, description, inputSchema: {...} },
  async ({ programId, ...args }, extra) => {
    try {
      const resolved = resolveUserId(extra, userId)
      assertProgramIdShape(programId)
      ...
      return jsonResult({ userId: resolved, ... })
    } catch (error: unknown) { return errorResult(error) }
  })
```

### UNIT_CONVERSION_LAZY
```ts
// SOURCE: src/lib/mcp/program-patch-tools.ts:117-143 — resolve the user's unit
// ONLY when a weight arg is a real number; echo the basis unit in the response.
basis = unit ?? (await getWeightUnit(resolved))
patch.suggestedLoadKg = toKgLoad(args.suggestedLoad, basis)
```

### DEFERRABLE_MIGRATION
```sql
-- SOURCE: drizzle/0004_glamorous_vin_gonzales.sql — drizzle-kit generate, then
-- hand-append DEFERRABLE INITIALLY DEFERRED with a why-comment (only when a
-- renumber can transiently collide; NOT needed for Phase 5's new uniques).
ALTER TABLE "program_days" ADD CONSTRAINT "..." UNIQUE("program_id","position") DEFERRABLE INITIALLY DEFERRED;
```

### PURE_MATH_MODULE
```ts
// SOURCE: src/lib/one-rep-max.ts — pure exported functions, named constants,
// null for unanswerable input, full precision (round only at display).
export const MAX_RELIABLE_REPS = 12
export function estimate1RM(reps: number | null, weightKg: number | null): number | null
```

### DB_TEST_HARNESS
```ts
// SOURCE: src/db/program-patches.test.ts:1-60 — chain-recording mock: selectQueue
// feeds reads in call order; records[] captures insert:/update:/delete:<table>.
const records: { op: string; values?: unknown }[] = []
let selectQueue: unknown[][] = []
```

### TOOL_TEST_HARNESS
```ts
// SOURCE: src/lib/mcp/program-patch-tools.test.ts:1-35 — vi.mock the db module
// (defining its own ProgramPatchError so instanceof matches), capture registered
// tools from a fake McpServer, invoke handlers directly.
vi.mock('@/db/program-patches', () => { class ProgramPatchError extends Error {} ... })
```

### WGER_DEFENSIVE_PARSE
```ts
// SOURCE: src/lib/wger.ts:87-113 — validate every field before reading; a bad
// record returns null (dropped), never throws; optional keys omitted when empty.
function mapExercise(raw: unknown): Exercise | null
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/progression.ts` | CREATE | Pure engine: RPE table, per-scheme week-N derivation, deload, volume interpolation |
| `src/lib/progression.test.ts` | CREATE | Exhaustive unit tests (the PRD's top risk mitigation) |
| `src/db/schema.ts` | UPDATE | `program_exercise_muscles`, `program_set_overrides`, `program_exercises.supersetGroup` |
| `drizzle/0005_*.sql` + meta | CREATE | Migration (generate; plain uniques, no hand edit needed) |
| `src/db/schema.test.ts` | UPDATE | New tables/columns/uniques asserted first (TDD) |
| `src/lib/wger.ts` | UPDATE | Parse `muscles`/`muscles_secondary` into `Exercise` |
| `src/lib/wger.test.ts` | UPDATE | Muscles parse cases (present/missing/empty `name_en`) |
| `src/lib/program-input.ts` | UPDATE | Tighten `progressionSchema` bounds; `setOverrideSchema` |
| `src/lib/program-input.test.ts` | UPDATE | Bounds + override schema tests |
| `src/db/programs.ts` | UPDATE | Muscle tagging on insert; overrides in detail reads; `nextProgramWeek`; engine-driven `instantiateProgramDay` |
| `src/db/save-program.test.ts`, `src/db/instantiate-program.test.ts` | UPDATE | New behavior |
| `src/db/program-patches.ts` | UPDATE | `supersetGroup` in exercise patch; muscle retag on `wgerExerciseId` change; override upsert/remove ops |
| `src/db/program-patches.test.ts` | UPDATE | New ops |
| `src/lib/mcp/program-tools.ts` | UPDATE | `get_program` exposes muscles/supersetGroup/overrides; `instantiate_program_day` auto-week; `preview_program_week` |
| `src/lib/mcp/program-patch-tools.ts` | UPDATE | `supersetGroup` arg; `set_program_set_override`/`remove_program_set_override` |
| `src/lib/mcp/tools.test.ts` | UPDATE | Tool-name inventory (+3 names) |
| `src/lib/mcp/program-tools.test.ts`, `src/lib/mcp/program-patch-tools.test.ts` | UPDATE | Handler tests |

## NOT Building
- Manual muscle-override tool (auto-derived from wger only; re-tag by changing `wgerExerciseId`)
- Technique stage expansion into live `sets` at instantiation (stages stay plan-side; user logs them via `add_set` — targets stay on the program, reality on the workout)
- Block/DUP as first-class schemes (the overrides table IS the escape hatch)
- A stored `programs.current_week` counter (rejected: drifts from reality)
- Any Web UI (Phase 6)
- Backfilling muscles onto pre-existing programs (POC; re-upsert re-tags)

---

## Step-by-Step Tasks

> Commit groups: **A** = engine lib (tasks 1–2), **B** = schema + wger + zod (3–6), **C** = db integration (7–10), **D** = MCP surface (11–14). Each group typechecks/tests green on its own.

### Task 1: RPE→%1RM chart (`src/lib/progression.ts`)
- **ACTION**: Create the module with the RPE chart and lookup.
- **IMPLEMENT**: chart keyed by reps 1–12 × RPE 6.0–10.0 in 0.5 steps (store RPE keys as `rpe * 2` integers to dodge float keys), standard RTS values; `export function percentOf1RM(reps: number, rpe: number): number | null` — null outside range; snap rpe DOWN to the nearest 0.5.
- **MIRROR**: PURE_MATH_MODULE.
- **IMPORTS**: none.
- **GOTCHA**: full precision, no rounding — display rounding is the tool layer's job.
- **VALIDATE**: `npx vitest run src/lib/progression.test.ts` — spot-check known chart values (1@10=1.0, 5@8≈0.81, 8@8≈0.74).

### Task 2: Week-N derivation engine (`src/lib/progression.ts`)
- **ACTION**: Add the per-exercise derivation the instantiation/preview layers call.
- **IMPLEMENT**:
  ```ts
  export interface ExerciseHistoryInput { e1rmKg: number | null; lastSets: { reps: number | null; weightKg: number | null }[] | null }
  export interface DerivedSet { setNumber: number; setType; metricMode; repMin; repMax; rir; rpe; loadKg: number | null; tempo; durationSec; distanceM; technique; derivedFrom: 'template' | 'scheme' | 'deload' }
  export function deriveWeekSets(args: {
    sets: ProgramSetRowLike[]            // week-1 template rows, ordered
    progression: Progression | null
    week: number; mesocycleWeeks: number; deloadWeek: number | null
    history: ExerciseHistoryInput
  }): DerivedSet[]
  ```
  Scheme rules (working/backoff/amrap sets only; warmups pass through untouched):
  - `linear`: `loadKg = base + incrementKg * weekIndex` where `weekIndex` counts non-deload weeks strictly before `week`; base = the set's `suggestedLoadKg` (null base → null load).
  - `double-progression`: if `history.lastSets` exists and every logged working set hit the scheme's `repMax` → base + incrementKg, else base.
  - `percent-1rm`: `loadKg = trainingMaxKg * weekPercents[min(week, weekPercents.length) - 1]`.
  - `rpe-target`: `loadKg = history.e1rmKg * percentOf1RM(set.repMax ?? set.repMin ?? MAX_RELIABLE_REPS, targetRpe)`; null e1RM → null load; also stamp `rpe = targetRpe`.
  - `weekly-volume`: working-set count for week = `round(mev + (mrv - mev) * nonDeloadIndex / (nonDeloadTotal - 1))` (single-week meso → mev); grow by cloning the last working set, shrink from the end.
  - **Deload week** (`week === deloadWeek`): after scheme derivation, `loadKg *= DELOAD_LOAD_FACTOR` (0.85) and working-set count → `ceil(n * DELOAD_SET_FACTOR)` (0.5), min 1. Export both constants.
  - `progression: null` → template passes through (deload still applies).
- **MIRROR**: PURE_MATH_MODULE. History inputs (`e1rmKg` via `bestSet`/`estimate1RM`) are computed by the CALLER — the engine stays IO-free.
- **IMPORTS**: `type Progression` from `@/lib/program-input`; `MAX_RELIABLE_REPS` from `./one-rep-max`.
- **GOTCHA**: week beyond `mesocycleWeeks` → clamp to the last scheme value (no extrapolation past the block); never emit negative loads; keep `setNumber` 1-based contiguous after count changes.
- **VALIDATE**: unit tests per scheme × {normal week, deload week, missing history, null base, week > meso}.

### Task 3: Schema additions (`src/db/schema.ts`) — write `schema.test.ts` assertions FIRST
- **ACTION**: Add two tables + one column.
- **IMPLEMENT**:
  ```ts
  export const programExerciseMuscles = pgTable('program_exercise_muscles', {
    id: uuid('id').defaultRandom().primaryKey(),
    programExerciseId: uuid('program_exercise_id').notNull()
      .references(() => programExercises.id, { onDelete: 'cascade' }),
    muscle: text('muscle').notNull(),           // wger name_en (fallback name)
    role: text('role').notNull(),               // 'primary' | 'secondary'
  }, (t) => [unique('program_exercise_muscles_unique').on(t.programExerciseId, t.muscle),
             index('program_exercise_muscles_exercise_idx').on(t.programExerciseId)])

  export const programSetOverrides = pgTable('program_set_overrides', {
    id: uuid('id').defaultRandom().primaryKey(),
    programSetId: uuid('program_set_id').notNull()
      .references(() => programSets.id, { onDelete: 'cascade' }),
    week: integer('week').notNull(),            // 1-based
    // nullable copies of the program_sets TARGET columns (null = field not overridden):
    // repMin, repMax, rir, rpe, suggestedLoadKg, tempo, durationSec, distanceM, technique
    // (same column types as program_sets; NO setType/metricMode — see Notes)
  }, (t) => [unique('program_set_overrides_set_week_unique').on(t.programSetId, t.week)])

  // on programExercises:
  supersetGroup: integer('superset_group'),     // same non-null value within a day = superset
  ```
  Add `relations`: exercises→muscles (many), sets→overrides (many), matching the existing relations block style (schema.ts 168+).
- **MIRROR**: programSets column style (schema.ts 141–166). DEFERRABLE not needed — no renumber ever touches these uniques.
- **GOTCHA**: `role` as text + app-level enum, matching the `setType`/`metricMode` precedent (no pgEnum in this schema).
- **VALIDATE**: `npx vitest run src/db/schema.test.ts` (red → green).

### Task 4: Migration 0005
- **ACTION**: `npm run db:generate`, review SQL (plain uniques — no hand edit), apply with `npm run db:migrate` at the end of group B.
- **VALIDATE**: migrate applies clean; `npx tsc --noEmit`.

### Task 5: wger muscles parse (`src/lib/wger.ts`) — tests first
- **ACTION**: Extend `Exercise`, `WgerExerciseInfo`, `mapExercise`.
- **IMPLEMENT**: `WgerExerciseInfo` gains `muscles` / `muscles_secondary: { id: number; name: string; name_en: string; is_front: boolean }[]`; `Exercise` gains `muscles?: string[]; musclesSecondary?: string[]` — prefer non-empty `name_en`, fall back to `name`, drop non-strings; omit the key entirely when empty (same convention as `equipment`).
- **MIRROR**: WGER_DEFENSIVE_PARSE.
- **GOTCHA**: wger's `name_en` is often `""` — treat empty string as missing.
- **VALIDATE**: `npx vitest run src/lib/wger.test.ts`.

### Task 6: Zod tightening + override schema (`src/lib/program-input.ts`) — tests first
- **ACTION**: Bound the Phase-1 progression params; add `setOverrideSchema`.
- **IMPLEMENT**: `incrementKg: z.number().min(0).max(MAX_WEIGHT)`; `trainingMaxKg: z.number().min(0).max(MAX_WEIGHT)`; `weekPercents: z.array(z.number().min(0).max(2)).min(1).max(52)`; `targetRpe: z.number().min(0).max(10)`; double-progression `repMin/repMax` int 0–MAX_REPS; weekly-volume `mevSets/mrvSets` int 0–100. Apply the two cross-field rules (`repMin ≤ repMax`, `mevSets ≤ mrvSets`) via a `superRefine` on the WHOLE `progressionSchema` union (members of a discriminatedUnion can't carry `.refine` themselves). `export const setOverrideSchema` = the nullable-optional target fields of `programSetSchema` minus `setType`/`metricMode`.
- **MIRROR**: VALIDATION_SHARED_PREDICATE.
- **GOTCHA**: existing stored progressions must still parse — bounds are supersets of sane data, but run the full suite to confirm no regression.
- **VALIDATE**: `npx vitest run src/lib/program-input.test.ts`.

### Task 7: Muscle tagging on write (`src/db/programs.ts` + `src/db/program-patches.ts`)
- **ACTION**: Tag exercises at author time.
- **IMPLEMENT**: Fetch the wger catalog ONCE per save (`getAllExercises()` — in-memory cached) BEFORE the transaction, build a `Map<number, Exercise>`; in `insertProgramChildren`, after each `programExercises` insert, bulk-insert `programExerciseMuscles` rows (primary + secondary roles; skip unknown ids). Same tagging in `addProgramExercise`; in `updateProgramExercise`, when `wgerExerciseId` changes: delete the exercise's muscle rows, insert fresh ones.
- **MIRROR**: `insertProgramChildren`'s parent-then-children shape (programs.ts 63–103); OWNERSHIP_FINDER for the patch ops.
- **GOTCHA**: `getAllExercises` can throw (network, first fetch) — catch and proceed UNTAGGED (tags are enrichment, not integrity; log nothing, it's a POC). Never call the network inside a transaction.
- **VALIDATE**: `npx vitest run src/db/save-program.test.ts src/db/program-patches.test.ts`.

### Task 8: Override ops (`src/db/program-patches.ts`) — tests first
- **ACTION**: `setProgramSetOverride` / `removeProgramSetOverride`.
- **IMPLEMENT**: Address by `(programId, dayPosition, exercisePosition, setNumber, week)` via `findOwnedExercise` → resolve the set row → upsert the override (`onConflictDoUpdate` on the (set, week) unique; `definedFields` merge semantics, explicit null clears a field; if the merged override is all-null → delete the row). Validate the MERGED (base set ⊕ override) row with `programSetIntegrityViolation` → `ProgramPatchError`. Bump `updatedAt`.
- **MIRROR**: `updateProgramSet`'s merge-then-revalidate (program-patches.ts 559–618); ERROR_CHANNELS.
- **GOTCHA**: `week ≥ 1`; overriding the deload week is allowed — override wins over deload (precedence note below); removing a nonexistent override → null (not-found channel).
- **VALIDATE**: `npx vitest run src/db/program-patches.test.ts`.

### Task 9: Week auto-derive (`src/db/programs.ts`) — tests first
- **ACTION**: `export async function nextProgramWeek(userId: string, programId: string): Promise<number>`.
- **IMPLEMENT**: Join `workouts.program_day_id → program_days.program_id`, filter `workouts.user_id`, `max(program_week)` = `current`; no history → 1. If every day of the program already has a workout at `current` → `min(current + 1, mesocycleWeeks)`, else `current`.
- **MIRROR**: the `max()` aggregate-read style of `addProgramDay` (program-patches.ts 198–202).
- **GOTCHA**: workouts whose plan day was deleted (`onDelete: set null`) drop out of the join — acceptable; clamp to `mesocycleWeeks` so a finished meso re-runs its last week rather than extrapolating.
- **VALIDATE**: `npx vitest run src/db/instantiate-program.test.ts`.

### Task 10: Engine-driven instantiation (`src/db/programs.ts`) — tests first
- **ACTION**: Rework `instantiateProgramDay`.
- **IMPLEMENT**: Before the transaction: load day (existing) + program row (`mesocycleWeeks`, `deloadWeek`) + overrides for the day's set ids at `week` + per-exercise history (batched `getExerciseHistoryBefore` for e1RM via `bestSet`; `getLastPerformance` per exercise for double-progression's last sets). Per exercise: `deriveWeekSets(...)` → apply overrides (a non-null override field wins over the derived value) → seed `sets` from the DERIVED list (weight = derived `loadKg` for `reps_weight` only; row count may differ from the template).
- **MIRROR**: the existing read-then-seed structure and its concurrency comment (programs.ts 226–275) — keep and extend the comment.
- **GOTCHA**: keep the engine call OUTSIDE the tx (pure); only inserts inside. Overrides apply after deload (precedence).
- **VALIDATE**: `npx vitest run src/db/instantiate-program.test.ts` — linear week 3; deload halves sets; override pins load; rpe-target with no history seeds null weight; weekly-volume changes seeded count.

### Task 11: `get_program` enrichment + auto-week instantiate (`src/lib/mcp/program-tools.ts`)
- **ACTION**: Expose the new data; wire `nextProgramWeek`.
- **IMPLEMENT**: `getProgramDetail`/`getProgramDayDetail` gain `with: { muscles }` / `sets: { with: { overrides } }`; `get_program` response adds per-exercise `muscles: { primary: string[]; secondary: string[] }` + `supersetGroup`, per-set `overrides: [{ week, ...fields }]`. `instantiate_program_day`: `week` optional → `week ?? await nextProgramWeek(...)`; response `{ programWeek, weekDerived: boolean }`.
- **MIRROR**: MCP_TOOL_REGISTRATION; the existing kg→display conversion in this file's `get_program` handler.
- **GOTCHA**: override `suggestedLoadKg` needs the SAME kg→display conversion as base sets.
- **VALIDATE**: `npx vitest run src/lib/mcp/program-tools.test.ts`.

### Task 12: Override + superset tools (`src/lib/mcp/program-patch-tools.ts`) — tests first
- **ACTION**: Two new tools + one new arg.
- **IMPLEMENT**: `set_program_set_override` (positions + `setNumber` + `week` + the `setPatchArgs` scalar fields MINUS setType/metricMode; `unit` lazy conversion reusing the `buildSetPatch` helper shape) and `remove_program_set_override` (positions + `setNumber` + `week`). `update_program_exercise` gains `supersetGroup: z.number().int().min(0).nullable().optional()` (null clears).
- **MIRROR**: MCP_TOOL_REGISTRATION, UNIT_CONVERSION_LAZY, ERROR_CHANNELS, `isEmptyPatch` guard.
- **GOTCHA**: tool descriptions must state the precedence explicitly: "an override wins over both the progression engine and the deload modifier for that week."
- **VALIDATE**: `npx vitest run src/lib/mcp/program-patch-tools.test.ts src/lib/mcp/tools.test.ts` (inventory grows by 3: two override tools + preview).

### Task 13: `preview_program_week` (`src/lib/mcp/program-tools.ts`) — tests first
- **ACTION**: Dry-run read tool.
- **IMPLEMENT**: Args `{ programId, week?: int ≥ 1, unit?, userId? }` (week defaults via `nextProgramWeek`). Load full program + overrides + batched history, run `deriveWeekSets` per exercise (NO writes), return per day → per exercise: name, muscles, supersetGroup, derived sets in display units with `derivedFrom: 'template' | 'scheme' | 'deload' | 'override'` per set, plus `volume: { [muscle]: workingSetCount }` aggregated over primary muscles, and `{ week, weekDerived }`.
- **MIRROR**: the `get_program` handler shape + kg→display conversion.
- **GOTCHA**: this is the agent's deterministic feedback loop — keep it one program read + one batched history read; no N+1.
- **VALIDATE**: `npx vitest run src/lib/mcp/program-tools.test.ts`.

### Task 14: Docs touch-ups
- **ACTION**: Update the module headers of `program-patches.ts` (override ops) and `tools.ts` registration comment; mark PRD Phase 5 `in-progress` with this plan linked.
- **VALIDATE**: `npm run lint`.

---

## Testing Strategy

### Unit Tests (highest-value cases)

| Test | Input | Expected Output | Edge? |
|---|---|---|---|
| RPE chart known values | (1,10) (5,8) (8,7.5) | 1.0 / ≈0.81 / ≈0.70 | |
| RPE out of range | (13,8), (5,5.5) | null | ✓ |
| linear skips deload in index | base 100, inc 2.5, deload=2, week 3 | 102.5 (one non-deload step) | ✓ |
| deload derivation | 4 working sets @100 | 2 sets @85 | |
| double-progression advance | last sets all hit repMax | base + increment | |
| double-progression hold | one set short | base | ✓ |
| %1RM clamp past percents | week 9, 8 percents | percents[7] | ✓ |
| rpe-target no history | e1rmKg null | loadKg null, rpe stamped | ✓ |
| weekly-volume interpolation | mev 8 mrv 14, 5-week meso | monotone 8→14 across non-deload weeks | |
| override wins over deload | derived 85 (deload), override 95 | seeded 95 | ✓ |
| override merge invalid | duration-mode set + override clearing durationSec | ProgramPatchError | ✓ |
| muscle tag on save | wger id in catalog | `insert:program_exercise_muscles` recorded | |
| retag on swap | `wgerExerciseId` change | delete + insert muscle rows | |
| nextProgramWeek | fresh / mid-cycle / cycle complete | 1 / current / current+1 clamped | ✓ |
| wger `name_en` empty | `name_en: ""` | falls back to `name` | ✓ |

### Edge Cases Checklist
- [ ] Empty history (every scheme must not throw)
- [ ] `progression: null` passthrough + deload still applies
- [ ] Week > mesocycleWeeks (clamp)
- [ ] Override reduced to all-null (row deleted)
- [ ] Warmup sets untouched by schemes and by deload set-halving
- [ ] Program with zero instantiations (auto-week = 1)
- [ ] wger catalog fetch failure (untagged save succeeds)

## Validation Commands

```bash
npx tsc --noEmit                          # EXPECT: zero errors
npx eslint src/                           # EXPECT: zero errors on touched files
npm test                                  # EXPECT: all pass
npm run db:generate && npm run db:migrate # EXPECT: 0005 applies clean
npm run build                             # EXPECT: compiles
```

Manual (dogfood via MCP):
- [ ] Author a program with `progression: { scheme: 'linear', incrementKg: 2.5 }` + `deloadWeek`
- [ ] `preview_program_week` weeks 1 / 3 / deload — loads progress; deload halves sets at 0.85 load
- [ ] `set_program_set_override` week 3 → preview shows the pinned value as `derivedFrom: 'override'`
- [ ] `instantiate_program_day` with no `week` → correct auto week; seeded weights match the preview
- [ ] `get_program` shows muscles + supersetGroup; preview shows volume-per-muscle

## Acceptance Criteria
- [ ] Instantiating week 3 yields progressed targets (PRD success signal)
- [ ] Deload week derives reduced volume/load
- [ ] A timed plank and a drop-set author + instantiate + log cleanly (existing flows unbroken)
- [ ] Volume-per-muscle computable (preview returns it; the relation supports raw SQL)
- [ ] All validation commands pass; tool inventory test updated

## Completion Checklist
- [ ] Engine is 100% pure (no IO imports in `progression.ts`)
- [ ] Error channels everywhere: null → ToolError not-found; ProgramPatchError → verbatim
- [ ] kg canonical in DB/JSONB; display units only at the tool boundary
- [ ] No drive-by refactors outside the listed files
- [ ] Commit groups A→D each green in isolation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Engine math subtly wrong (deload/interpolation off-by-one) | M | H | Table-driven tests with hand-computed expectations; week indexing tested at boundaries |
| History-dependent schemes slow instantiation (N+1 queries) | M | M | Batch via `getExerciseHistoryBefore`; all reads before the tx |
| Precedence confusion (override vs deload vs scheme) | M | M | `derivedFrom` per set in preview; explicit precedence line in every tool description |
| wger `name_en` inconsistencies fragment muscle names | L | M | Defensive parse + fallback; names are aggregation keys only, no FK |
| Growing tool count degrades agent tool choice | L | M | Only 3 new tools; descriptions state when NOT to use them |

## Notes
- **Precedence, stated once: override > deload modifier > progression scheme > template row.**
- Deload constants (`DELOAD_LOAD_FACTOR = 0.85`, `DELOAD_SET_FACTOR = 0.5`) are exported named constants — tunable without hunting.
- `program_set_overrides` deliberately excludes `setType`/`metricMode`: changing a set's SHAPE mid-block is an edit (`update_program_set`), not a week override.
- Muscle names are denormalized text by design (POC); if substitutions/MEV tracking later needs identity, introduce a lookup table then.
- RPE chart values: use the standard RTS chart; cite the row/col in test names so reviewers can verify against the published table.
