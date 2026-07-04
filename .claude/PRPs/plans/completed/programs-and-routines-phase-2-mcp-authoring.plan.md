# Plan: Programs & Routines — Phase 2 (MCP Coarse Authoring + Read)

## Summary
Expose the Phase 1 program data layer to the agent: a coarse `upsert_program` (create + full-replace, Zod-validated, display→kg conversion, one transaction) plus `get_program`, `list_programs`, `delete_program`, `set_program_status`, and a `program://{id}` resource. This is the program twin of the existing workout MCP surface (`create_workout`/read-tools/resources). After this phase an agent can author a whole program conversationally and read it back in the user's unit.

## User Story
As an intermediate→advanced lifter's agent, I want MCP tools to create, read, list, status-change, and delete a whole training program, so that the user can build and review a structured mesocycle by talking to me — without a UI.

## Problem → Solution
Phase 1 added `db/programs.ts` but nothing exposes it to the agent; the MCP server still only knows workouts. → Register a `registerProgramTools` surface mirroring `registerWriteTools` + `registerReadTools` exactly (resolveUserId authz boundary, display↔kg conversion, leak-safe `ToolError`/`errorResult` split, id-shape guard), wired into `registerTools`, plus the `program://{id}` resource twin.

## Metadata
- **Complexity**: Large
- **Source PRD**: `.claude/PRPs/prds/programs-and-routines.prd.md`
- **PRD Phase**: Phase 2 — MCP coarse authoring + read
- **Estimated Files**: 3 new (`program-id.ts`, `program-tools.ts`, `program-tools.test.ts`) + 4 edited (`tools.ts`, `tools.test.ts`, `resources.ts`, `resources.test.ts`)

---

## UX Design

Internal/agent-facing change — no web UI. The "user experience" here is the **agent tool surface**.

### Before
```
Agent tools: ping, whoami, list_workouts, get_workout, search_exercises,
get_last_performance, get_weight_unit, create_workout, update_workout,
delete_workout, set_weight_unit, update_set, add_set, remove_set,
set_workout_meta. Resource: workout://{id}
→ No way to author or read a program.
```

### After
```
+ upsert_program        (create when no id, full-replace when id given)
+ get_program           (one program, weights in user unit)
+ list_programs         (user's programs, newest first)
+ delete_program
+ set_program_status    (draft|active|archived)
+ Resource: program://{id}
→ Agent authors "build me a 5-day split" in one upsert_program, reads it back.
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Agent authoring | `create_workout` only (a dated log) | `upsert_program` (a reusable plan) | Coarse create/replace, matching how an LLM generates a whole structure |
| Agent read | `get_workout`, `workout://{id}` | + `get_program`, `program://{id}` | Same display-unit + echo-userId conventions |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 (critical) | `src/lib/mcp/write-tools.ts` | 1-204 | The exact create/update/delete tool pattern to mirror: display→kg conversion (`toKgInput`/`assertWeightsInRange`/`validate`), `resolveUserId`, id-shape guard, `ToolError`/`errorResult`, not-found handling, echo `{userId, unit, ...}` |
| P0 (critical) | `src/lib/mcp/read-tools.ts` | 1-225 | `list_*`/`get_*` tool pattern + the shared `buildWorkoutPayload` (kg→display projection) reused by tool and resource — the model for `buildProgramPayload` |
| P0 (critical) | `src/db/programs.ts` | all | The Phase-1 ops these tools wrap: `saveProgram`/`updateProgram`/`deleteProgram`/`setProgramStatus`/`listPrograms`/`getProgramDetail` (+ `ProgramDetail` type) |
| P0 (critical) | `src/lib/program-input.ts` | all | `parseProgramInput`, `ProgramInput`, and the reusable building blocks (`metricModeSchema`, `setTypeSchema`, `statusSchema`, `techniqueSchema`, `progressionSchema`) the tool input schema composes |
| P1 (important) | `src/lib/mcp/workout-id.ts` | 1-15 | The `assertWorkoutIdShape` to clone as `assertProgramIdShape` |
| P1 (important) | `src/lib/mcp/resources.ts` | 1-60 | The `workout://{id}` resource to twin as `program://{id}` |
| P1 (important) | `src/lib/mcp/tools.ts` | 1-54 | Where `registerProgramTools` gets wired (alongside read/write/patch/resources) |
| P1 (important) | `src/lib/mcp/errors.ts` / `result.ts` | all | `ToolError`, `jsonResult`, `errorResult` — the leak-safe envelope helpers |
| P1 (important) | `src/lib/units.ts` | 1-40 | `displayToKg`/`kgToDisplay`/`WeightUnit` for the conversion layer |
| P2 (reference) | `src/lib/mcp/write-tools.test.ts` | all | The fake-server + handler-map test pattern to mirror for `program-tools.test.ts` (impersonation, no-user gate, over-max, db-leak) |
| P2 (reference) | `src/lib/mcp/resources.test.ts` | all | The resource read-callback test pattern to extend for `program://{id}` |
| P2 (reference) | `src/lib/mcp/tools.test.ts` | 42-74 | Asserts the EXACT tool list + resource set — MUST be updated this phase |

## External Documentation
No external research needed — feature uses established internal MCP patterns. `@modelcontextprotocol/sdk` and `zod` are already wired throughout the MCP layer.

---

## Patterns to Mirror

### DISPLAY→KG CONVERSION (author side)
```ts
// SOURCE: src/lib/mcp/write-tools.ts:40-88
function toKgInput(raw: RawWorkout, unit: WeightUnit): RawWorkout {
  return { /* ...map sets... */ weight: s.weight === null ? null : displayToKg(s.weight, unit) }
}
function assertWeightsInRange(kgInput: RawWorkout, unit: WeightUnit): void {
  const outOfRange = /* any set weight <0 or >MAX_WEIGHT_KG */ false
  if (!outOfRange) return
  throw new ToolError(`set weight must be a number between 0 and ${kgToDisplay(MAX_WEIGHT_KG, unit)} ${unit}, or null`)
}
function validate(raw: RawWorkout, unit: WeightUnit): WorkoutInput {
  const kgInput = toKgInput(raw, unit)
  assertWeightsInRange(kgInput, unit)
  try { return parseWorkoutInput(kgInput) }
  catch (error: unknown) { throw new ToolError(error instanceof Error ? error.message : 'invalid workout input') }
}
```

### TOOL HANDLER (resolve user → guard → validate → db → echo)
```ts
// SOURCE: src/lib/mcp/write-tools.ts:104-129, 146-161
async ({ name, exercises, unit, startedAt, userId }, extra) => {
  try {
    const resolved = resolveUserId(extra, userId)            // authz boundary
    const basis = unit ?? (await getWeightUnit(resolved))    // unit basis
    const parsed = validate({ name, exercises, startedAt }, basis)
    const { id } = await saveWorkout(resolved, parsed)
    return jsonResult({ userId: resolved, unit: basis, workoutId: id })
  } catch (error: unknown) { return errorResult(error) }
}
// update variant: assertWorkoutIdShape(id); if (!result) throw new ToolError(`Workout ${id} not found for user ${resolved}`)
```

### SHARED PAYLOAD PROJECTION (kg→display), reused by tool + resource
```ts
// SOURCE: src/lib/mcp/read-tools.ts:189-215
export function buildWorkoutPayload(workout: WorkoutDetail, resolved: string, unit: WeightUnit): WorkoutPayload {
  return { userId: resolved, unit, workout: { /* ...startedAt.toISOString(), weight: kgToDisplay(...) ... */ } }
}
```

### ID SHAPE GUARD
```ts
// SOURCE: src/lib/mcp/workout-id.ts:3-15
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function assertWorkoutIdShape(id: string): void {
  if (!UUID_RE.test(id)) throw new ToolError(`Workout ${id} not found`)
}
```

### RESOURCE TWIN
```ts
// SOURCE: src/lib/mcp/resources.ts:24-59
server.registerResource('workout', new ResourceTemplate('workout://{id}', { list: undefined }),
  { title, description, mimeType: 'application/json' },
  async (uri, variables, extra) => {
    const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
    try {
      if (!id) throw new ToolError('workout id is required')
      const resolved = resolveUserId(extra)
      assertWorkoutIdShape(id)
      const workout = await getWorkoutDetail(resolved, id)
      if (!workout) throw new ToolError(`Workout ${id} not found for user ${resolved}`)
      const unit = await getWeightUnit(resolved)
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(buildWorkoutPayload(workout, resolved, unit)) }] }
    } catch (error: unknown) {
      if (error instanceof ToolError) throw error
      console.error('MCP resource error:', error); throw new Error('MCP resource read failed')
    }
  })
```

### TEST STRUCTURE (fake server + handler map + db mocks)
```ts
// SOURCE: src/lib/mcp/write-tools.test.ts:32-52, 113-128, 235-263
function fakeServer() { /* records registerTool(name,_cfg,handler) into a Map */ }
// impersonation: token userId always wins over arg/env
// no-user gate: delete MCP_DEV_USER_ID → isError /userId/, db never called
// db-leak: mockRejectedValue(new Error('secret-host')) → text 'MCP tool failed', console.error spy called
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/mcp/program-id.ts` | CREATE | `assertProgramIdShape` — clone of `workout-id.ts` with a program not-found message |
| `src/lib/mcp/program-tools.ts` | CREATE | `registerProgramTools` (5 tools) + `buildProgramPayload` + display schema + `toKgProgram`/range-check/`validateProgram` |
| `src/lib/mcp/program-tools.test.ts` | CREATE | Mirror `write-tools.test.ts` + read coverage |
| `src/lib/mcp/tools.ts` | UPDATE | Call `registerProgramTools(server)` |
| `src/lib/mcp/tools.test.ts` | UPDATE | Add the 5 program tools to the expected list + assert `program` resource |
| `src/lib/mcp/resources.ts` | UPDATE | Register `program://{id}` resource using `buildProgramPayload` |
| `src/lib/mcp/resources.test.ts` | UPDATE | Add `program://{id}` read-callback tests |

## NOT Building (this phase)
- **`instantiate_program_day`**, seeding live `sets`, `get_workout` plan overlay — Phase 3.
- **Granular program patch/reorder tools** (`update_program_exercise`, add/remove/reorder day·exercise·set) — Phase 4.
- **Progression engine / technique execution** — Phase 5. The tools accept and return `technique`/`progression` JSONB **verbatim**; see the unit decision below.
- **Display-unit conversion of weights INSIDE the `technique`/`progression` JSONB tail.** `suggestedLoad` (the typed per-set column) IS converted display↔kg. Embedded loads in `technique.stages[].loadKg` / `progression` params are passed through as **kg** and documented as kg in the tool description. Walking the polymorphic JSON for unit conversion is deferred to Phase 5 (the engine that renders them). Rationale: the author→read loop for the typed targets is the MVP; technique is rarely authored in Phase 2.
- **Day/exercise/set counts in `list_programs`** — returns the program rows only (Phase 1 `listPrograms` has no aggregate query); a summary query can come later if needed.
- **Web UI** — Phase 6.

---

## Design — `program-tools.ts`

### Display-unit MCP input schema (composes Phase-1 building blocks)
```ts
import {
  metricModeSchema, setTypeSchema, statusSchema, techniqueSchema, progressionSchema,
  parseProgramInput, type ProgramInput,
} from '@/lib/program-input'

const unitArg = z.enum(['kg', 'lb']).optional()

// Display-unit set: `suggestedLoad` (user unit) instead of `suggestedLoadKg`. Fields
// stay optional/permissive here; parseProgramInput applies defaults + the refines.
const toolSetSchema = z.object({
  setType: setTypeSchema.optional(),
  metricMode: metricModeSchema.optional(),
  repMin: z.number().int().nullable().optional(),
  repMax: z.number().int().nullable().optional(),
  rir: z.number().int().nullable().optional(),
  rpe: z.number().nullable().optional(),
  suggestedLoad: z.number().nullable().optional(), // DISPLAY unit → kg before persist
  tempo: z.string().nullable().optional(),
  durationSec: z.number().int().nullable().optional(),
  distanceM: z.number().nullable().optional(),      // meters, not weight — no conversion
  technique: techniqueSchema.nullable().optional(), // kg, passthrough
})
const toolExerciseSchema = z.object({
  wgerExerciseId: z.number().int(),
  name: z.string(),
  progression: progressionSchema.nullable().optional(), // kg, passthrough
  sets: z.array(toolSetSchema),
})
const toolDaySchema = z.object({
  name: z.string(),
  notes: z.string().nullable().optional(),
  exercises: z.array(toolExerciseSchema),
})
// The raw ZodRawShape passed as `inputSchema` for upsert_program (id present → replace):
const upsertShape = {
  id: z.string().optional(),
  name: z.string(),
  status: statusSchema.optional(),
  mesocycleWeeks: z.number().int().optional(),
  deloadWeek: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  days: z.array(toolDaySchema),
  unit: unitArg,
  userId: z.string().optional(),
}
```

### Conversion + validation (mirrors `validate`/`toKgInput`/`assertWeightsInRange`)
```ts
type RawProgram = { /* the upsertShape minus id/unit/userId */ }

function toKgProgram(raw: RawProgram, unit: WeightUnit): unknown {
  return {
    name: raw.name, status: raw.status, mesocycleWeeks: raw.mesocycleWeeks,
    deloadWeek: raw.deloadWeek, notes: raw.notes,
    days: raw.days.map((d) => ({
      name: d.name, notes: d.notes,
      exercises: d.exercises.map((e) => ({
        wgerExerciseId: e.wgerExerciseId, name: e.name, progression: e.progression,
        sets: e.sets.map((s) => ({
          setType: s.setType, metricMode: s.metricMode,
          repMin: s.repMin, repMax: s.repMax, rir: s.rir, rpe: s.rpe,
          suggestedLoadKg: s.suggestedLoad == null ? s.suggestedLoad : displayToKg(s.suggestedLoad, unit),
          tempo: s.tempo, durationSec: s.durationSec, distanceM: s.distanceM,
          technique: s.technique,
        })),
      })),
    })),
  }
}

function assertLoadsInRange(kg: { days: { exercises: { sets: { suggestedLoadKg?: number | null }[] }[] }[] }, unit: WeightUnit): void {
  const out = kg.days.some((d) => d.exercises.some((e) => e.sets.some((s) =>
    s.suggestedLoadKg != null && (s.suggestedLoadKg < 0 || s.suggestedLoadKg > MAX_WEIGHT_KG))))
  if (!out) return
  throw new ToolError(`suggestedLoad must be a number between 0 and ${kgToDisplay(MAX_WEIGHT_KG, unit)} ${unit}, or null`)
}

function validateProgram(raw: RawProgram, unit: WeightUnit): ProgramInput {
  const kg = toKgProgram(raw, unit)
  assertLoadsInRange(kg as never, unit)
  try { return parseProgramInput(kg) }
  catch (error: unknown) { throw toolErrorFromZod(error) }
}

// ZodError → a concise, agent-readable ToolError (first issue, path-prefixed).
function toolErrorFromZod(e: unknown): ToolError {
  if (e instanceof z.ZodError) {
    const first = e.issues[0]
    const path = first?.path.length ? `${first.path.join('.')}: ` : ''
    return new ToolError(`${path}${first?.message ?? 'invalid program input'}`)
  }
  return new ToolError(e instanceof Error ? e.message : 'invalid program input')
}
```

### Read projection (kg→display), shared by `get_program` + resource
```ts
export interface ProgramPayload {
  userId: string
  unit: WeightUnit
  program: {
    id: string; name: string; status: string; mesocycleWeeks: number
    deloadWeek: number | null; notes: string | null; createdAt: string; updatedAt: string
    days: {
      id: string; name: string; position: number; notes: string | null
      exercises: {
        id: string; wgerExerciseId: number; name: string; position: number
        progression: unknown | null
        sets: {
          setNumber: number; setType: string; metricMode: string
          repMin: number | null; repMax: number | null; rir: number | null; rpe: number | null
          suggestedLoad: number | null   // display unit (from suggestedLoadKg)
          tempo: string | null; durationSec: number | null; distanceM: number | null
          technique: unknown | null      // kg, passthrough
        }[]
      }[]
    }[]
  }
}
export function buildProgramPayload(program: ProgramDetail, resolved: string, unit: WeightUnit): ProgramPayload {
  // map dates → ISO; suggestedLoadKg → kgToDisplay(...); technique/progression verbatim
}
```

### The five tools (all wrap resolveUserId + errorResult)
- `upsert_program` — `resolveUserId` → `basis = unit ?? getWeightUnit` → `validateProgram` → if `id`: `assertProgramIdShape(id)` + `updateProgram(resolved, id, parsed)` (null → `ToolError(`Program ${id} not found for user ${resolved}`)`) else `saveProgram(resolved, parsed)`. Echo `{ userId, unit: basis, programId }`.
- `get_program` — `assertProgramIdShape(id)` → `getProgramDetail` (null → not-found `errorResult`) → `getWeightUnit` → `jsonResult(buildProgramPayload(...))`.
- `list_programs` — `listPrograms(resolved)` → `jsonResult({ userId, programs: rows.map(r => ({ id, name, status, mesocycleWeeks, deloadWeek, createdAt: ISO, updatedAt: ISO })) })`.
- `delete_program` — `assertProgramIdShape(id)` → `const [deleted] = await deleteProgram(...)` → empty → not-found → echo `{ userId, programId, deleted: true }`.
- `set_program_status` — `inputSchema: { id, status: statusSchema, userId? }` → `assertProgramIdShape(id)` → `setProgramStatus(resolved, id, status)` (null → not-found) → echo `{ userId, programId, status }`.

---

## Step-by-Step Tasks

### Task 1: `src/lib/mcp/program-id.ts`
- **ACTION**: Clone `workout-id.ts` as `assertProgramIdShape`.
- **IMPLEMENT**: Same `UUID_RE`; `export function assertProgramIdShape(id: string): void { if (!UUID_RE.test(id)) throw new ToolError(`Program ${id} not found`) }`. Keep the same doc comment (a malformed id can't match any row; throwing a clean not-found beats a genericized cast error).
- **MIRROR**: ID SHAPE GUARD.
- **IMPORTS**: `import { ToolError } from './errors'`.
- **GOTCHA**: Don't refactor `workout-id.ts` to share the regex — mirror as a sibling (avoid a drive-by touching unrelated code).
- **VALIDATE**: `npx tsc --noEmit`.

### Task 2: `src/lib/mcp/program-tools.ts`
- **ACTION**: Create `registerProgramTools` (5 tools), `buildProgramPayload`, and the conversion/validation helpers + display schema per the Design section.
- **IMPLEMENT**: Exactly the Design section. Each handler: `try { resolveUserId(...) ... } catch (e) { return errorResult(e) }`. Echo `{ userId, ... }` (and `unit: basis` on `upsert_program`). Export `buildProgramPayload` + `ProgramPayload` (the resource imports them, mirroring `buildWorkoutPayload`).
- **MIRROR**: DISPLAY→KG CONVERSION, TOOL HANDLER, SHARED PAYLOAD PROJECTION.
- **IMPORTS**: `McpServer`; `z`; `resolveUserId`; `jsonResult, errorResult`; `ToolError`; `assertProgramIdShape` from `./program-id`; `displayToKg, kgToDisplay, type WeightUnit` from `@/lib/units`; `MAX_WEIGHT as MAX_WEIGHT_KG` from `@/lib/workout-input`; `metricModeSchema, setTypeSchema, statusSchema, techniqueSchema, progressionSchema, parseProgramInput, type ProgramInput` from `@/lib/program-input`; `saveProgram, updateProgram, deleteProgram, setProgramStatus, listPrograms, getProgramDetail, type ProgramDetail` from `@/db/programs`; `getWeightUnit` from `@/db/preferences`.
- **GOTCHA**: `inputSchema` must be a **ZodRawShape** (a plain object of field schemas), not `z.object(...)` — see `write-tools.ts:110`. `parseProgramInput` throws **ZodError** (not a plain `Error`); convert via `toolErrorFromZod` so the message isn't genericized. `distanceM` is meters — never unit-convert it. Resolve the unit once (only `upsert_program`/`get_program` need it; `list`/`delete`/`set_status` don't read weights).
- **VALIDATE**: `npx tsc --noEmit`; covered by Task 6 tests.

### Task 3: wire into `src/lib/mcp/tools.ts`
- **ACTION**: Import and call `registerProgramTools(server)` alongside the others.
- **IMPLEMENT**: `import { registerProgramTools } from './program-tools'`; add `registerProgramTools(server)` after `registerPatchTools(server)`. Update the file's doc comment to mention the program authoring/read tools.
- **MIRROR**: `tools.ts:50-53`.
- **IMPORTS**: as above.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 4: register `program://{id}` in `src/lib/mcp/resources.ts`
- **ACTION**: Add a second `server.registerResource('program', ...)` twinning the workout resource.
- **IMPLEMENT**: Clone the workout resource block; swap `assertWorkoutIdShape`→`assertProgramIdShape`, `getWorkoutDetail`→`getProgramDetail`, `buildWorkoutPayload`→`buildProgramPayload`, template `program://{id}`, message `Program ${id} not found...`. Keep the same throw-based leak-safe split.
- **MIRROR**: RESOURCE TWIN.
- **IMPORTS**: add `assertProgramIdShape` from `./program-id`; `buildProgramPayload` from `./program-tools`; `getProgramDetail` from `@/db/programs`.
- **GOTCHA**: A resource URI carries no `userId` arg → `resolveUserId(extra)` (env/token only), same as the workout resource.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 5: update `src/lib/mcp/tools.test.ts`
- **ACTION**: Extend the expected tool list and resource assertion.
- **IMPLEMENT**: Add `'delete_program'`, `'get_program'`, `'list_programs'`, `'set_program_status'`, `'upsert_program'` into the sorted `toEqual([...])` array (keep alphabetical). Add `expect([...resources.keys()]).toContain('program')` (a new `it`, or extend the existing resource test).
- **MIRROR**: `tools.test.ts:42-74`.
- **VALIDATE**: `npx vitest run src/lib/mcp/tools.test.ts`.

### Task 6: `src/lib/mcp/program-tools.test.ts`
- **ACTION**: Mirror `write-tools.test.ts` + read coverage.
- **IMPLEMENT** (mock `@/db/programs` + `@/db/preferences`; `fakeServer`/handler-map/`payload` helpers copied from write-tools.test.ts):
  - `registers exactly the five program tools` (sorted list).
  - `upsert_program` create: stored unit lb → `suggestedLoad` converted via `displayToKg`; `saveProgram` called with kg + parsed defaults (`status:'draft'`, set `setType:'working'`); echoes `{ userId, unit, programId }`.
  - `upsert_program` update: `id` present → `assertProgramIdShape` + `updateProgram` called; null result → isError `/not found/`; malformed id → `/not found/` without hitting db.
  - `upsert_program` impersonation: token userId beats arg/env; no-user gate → `/userId/`, db untouched.
  - `upsert_program` over-max `suggestedLoad` → isError naming the lb bound, never saves; explicit `unit:'kg'` → no conversion, kg bound message.
  - `upsert_program` timed set missing `durationSec` → isError `/durationSec/i` (ZodError surfaced), never saves.
  - `get_program`: returns `buildProgramPayload` shape, `suggestedLoad` in lb (`kgToDisplay`), ISO dates, `technique` verbatim; not-found → `/not found/`; malformed id guarded.
  - `list_programs`: maps rows with ISO dates.
  - `delete_program`: deleted:true; empty → `/not found/`; malformed id guarded.
  - `set_program_status`: calls `setProgramStatus`, echoes status; null → `/not found/`.
  - db-leak: `saveProgram` rejects with a secret host → text `'MCP tool failed'`, `console.error` spied.
- **MIRROR**: TEST STRUCTURE.
- **IMPORTS**: as in write-tools.test.ts but for `@/db/programs` ops; build raw display objects directly (no `parseProgramInput` needed in the test).
- **GOTCHA**: Mock the `@/db/programs` ops as `vi.fn()`; `getProgramDetail` mock returns a `ProgramDetail`-shaped object cast `as unknown as Awaited<ReturnType<typeof getProgramDetail>>` (same trick as resources.test.ts). Build raw tool args in **display** units (e.g. `suggestedLoad: 100`), not kg.
- **VALIDATE**: `npx vitest run src/lib/mcp/program-tools.test.ts`.

### Task 7: update `src/lib/mcp/resources.test.ts`
- **ACTION**: Add `program://{id}` read-callback tests.
- **IMPLEMENT**: Extend the `@/db/programs`+`@/db/preferences` mocks (add `getProgramDetail`); a `programDetail()` factory (program→day→exercise→sets with `suggestedLoadKg`); assert: registers a `program` resource templated on `program://{id}`; returns `buildProgramPayload` JSON with `suggestedLoad` in lb; not-found rejects `/not found/`; missing id rejects `/required/`; no-user rejects `/userId/`; db-reject → `'MCP resource read failed'` + console.error.
- **MIRROR**: `resources.test.ts` (whole file).
- **GOTCHA**: `resources.test.ts` currently mocks `@/db/workouts`; add a `@/db/programs` mock without breaking the workout-resource tests.
- **VALIDATE**: `npx vitest run src/lib/mcp/resources.test.ts`.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected | Edge? |
|---|---|---|---|
| upsert create converts load | `suggestedLoad:100`, unit lb | `saveProgram` gets kg, echo `{unit:'lb',programId}` | no |
| upsert update not-owned | id + body, `updateProgram`→null | isError `/not found/` | yes |
| upsert malformed id | `id:'not-a-uuid'` | `/not found/`, db untouched | yes |
| impersonation | arg+token userId differ | token wins, echo token | yes |
| no-user gate | no env/arg | `/userId/`, db untouched | yes |
| over-max load (lb) | `suggestedLoad` > ceiling | isError names lb bound, no save | yes |
| timed set no duration | `metricMode:'duration'` | isError `/durationSec/i`, no save | yes |
| get_program render | `getProgramDetail` stub | payload, `suggestedLoad` in lb, ISO dates, technique verbatim | no |
| get_program not-found | stub → undefined | `/not found/` | yes |
| list_programs | rows | ISO dates mapped | no |
| delete_program empty | `deleteProgram`→[] | `/not found/` | yes |
| set_program_status null | `setProgramStatus`→null | `/not found/` | yes |
| db leak | save rejects secret host | `'MCP tool failed'`, console.error | yes |
| resource program://{id} | detail stub | JSON payload in lb | no |

### Edge Cases Checklist
- [x] Empty input (`days:[]` / empty exercises/sets → ZodError surfaced as ToolError)
- [x] Maximum size input (`suggestedLoad` bound message in agent unit)
- [x] Invalid types (bad enums, non-int wgerExerciseId → surfaced)
- [ ] Concurrent access (no new concurrency surface; Phase-1 deferrable unique unchanged)
- [x] Network failure (db-reject leak test)
- [x] Permission denied (no-user gate + not-owned for every tool)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors.

### Unit Tests (affected area)
```bash
npx vitest run src/lib/mcp
```
EXPECT: All MCP tool/resource tests pass (new program-tools + updated tools/resources).

### Full Test Suite (no regressions)
```bash
npx vitest run --exclude '**/.claude/worktrees/**'
```
EXPECT: All pass. (Bare `npm run test` also runs the stray `.claude/worktrees/` checkout — known pre-existing pollution; exclude it.)

### Lint
```bash
npx eslint src
```
EXPECT: Clean. (Bare `npm run lint` lints untracked worktree/agent dirs — ignore; scope to `src`.)

### Build
```bash
npm run build
```
EXPECT: Succeeds; route table unchanged (the MCP route `/api/[transport]` already exists).

### Manual Validation (optional dogfood)
- [ ] With `MCP_DEV_USER_ID` set, call `upsert_program` with a 2-day split → returns `programId`.
- [ ] `get_program` that id → days/exercises/sets in the user's unit; `set_program_status active` → status flips; `list_programs` shows it; `delete_program` removes it.

---

## Acceptance Criteria
- [ ] All 7 tasks completed.
- [ ] `tsc`, `eslint src`, `vitest run --exclude worktrees`, `npm run build` pass.
- [ ] `registerProgramTools` registers exactly 5 tools; `registerTools` list + `program` resource updated and asserted.
- [ ] `upsert_program` round-trips: a display-unit program authored and read back via `get_program` in the same unit; weights stored as kg.
- [ ] Ownership + no-user gate enforced on every tool; not-owned surfaces as a clean not-found.

## Completion Checklist
- [ ] Handlers mirror `write-tools.ts`/`read-tools.ts` (resolveUserId, echo userId, ToolError/errorResult split).
- [ ] `buildProgramPayload` is the single projection shared by `get_program` and the resource (mirrors `buildWorkoutPayload`).
- [ ] Display↔kg only on `suggestedLoad`; `technique`/`progression` JSONB verbatim (documented as kg); `distanceM` never converted.
- [ ] ZodError surfaced as a concise `ToolError`, not genericized.
- [ ] Tests mirror the fake-server/handler-map pattern incl. impersonation, no-user, over-max, db-leak.
- [ ] Self-contained — no codebase searching needed.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `tools.test.ts` exact-list assertion breaks | M (expected) | Low | Task 5 updates it deliberately; it's a guard that the tool set changed on purpose |
| ZodError message too verbose for the agent | M | Low | `toolErrorFromZod` extracts the first issue + path; tested against `/durationSec/i` |
| Mixed units confuse (typed load display vs JSONB kg) | L | Low | Documented in tool descriptions + NOT Building; Phase 5 unifies when the engine renders technique |
| `inputSchema` given as `z.object` not raw shape | L | Med | GOTCHA in Task 2 + mirrors `write-tools.ts:110`; tsc/SDK catches it |
| Resource test cross-contamination (workouts vs programs mocks) | L | Low | Add `@/db/programs` mock alongside the existing `@/db/workouts` mock; keep both factories |

## Notes
- This is **Phase 2 of 6** and completes the MVP's author side. With Phase 3 (instantiation) it closes the author→log loop the PRD's hypothesis hinges on.
- The unit policy is the one real design call: typed `suggestedLoad` converts (the load the agent actually authors in Phase 2); the `technique`/`progression` JSONB tail passes through as kg and is documented as such. This avoids walking polymorphic JSON for conversion and is revisited in Phase 5 when the engine renders those fields. If dogfooding shows agents authoring technique loads in display units in Phase 2, revisit then.
- `list_programs` returns bare program rows (no child counts) — `db/programs.ts` has no aggregate query yet; add `listProgramSummaries` later only if the UI/agent needs counts.
