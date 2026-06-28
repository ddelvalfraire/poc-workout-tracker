# Plan: MCP Write Tools (Phase 3)

## Summary
Add four write MCP tools so a connected agent can mutate a user's training: `create_workout` (the headline "add my workout for me"), `update_workout`, `delete_workout`, and `set_weight_unit`. Each wraps an existing `src/db/*` write directly, resolves the target user via `resolveUserId`, accepts weights in the user's display unit (converting to canonical kg with `displayToKg`), and validates through the existing `parseWorkoutInput` trust boundary before persisting.

## User Story
As a lifter dogfooding the app through an AI agent,
I want the agent to create, edit, and delete my workouts and set my weight unit,
So that I can capture and correct training by talking instead of tapping.

## Problem → Solution
The MCP endpoint can read training (Phases 1–2) but exposes no way to write it — the headline "add it for me" capability is still missing → Four write tools wrap `saveWorkout`/`updateWorkout`/`deleteWorkout`/`setWeightUnit`, converting agent-supplied display-unit weights to kg and reusing `parseWorkoutInput` for validation, returning the resolved `userId`, `unit`, and new/affected `workoutId`.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/mcp-agent-server.prd.md`
- **PRD Phase**: Phase 3 — Write tools
- **Estimated Files**: 4 (2 new, 2 edited)

---

## UX Design

### Before
N/A — internal/agent-facing change. The "user" is an MCP client (e.g. Claude remote MCP). Before Phase 3, a connected agent can read history and the catalog but cannot persist or change anything.

### After
N/A — no end-user UI. After: the agent can call `create_workout`/`update_workout`/`delete_workout`/`set_weight_unit` and get back structured JSON confirming the resolved user, the unit basis, and the affected workout id.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| MCP tool list | 7 tools (ping, whoami + 5 read) | + `create_workout`, `update_workout`, `delete_workout`, `set_weight_unit` (11 total) | Registered via a new `registerWriteTools`, aggregated in `registerTools` |
| Logging a workout | impossible via agent | `create_workout` → validates + persists → `{ userId, unit, workoutId }` | Weights given in the user's unit, stored as kg |
| Editing / deleting | impossible via agent | `update_workout` / `delete_workout` → ownership-gated, ToolError on not-found | Mirrors `updateWorkoutAction`/`deleteWorkoutAction` control flow |
| Changing unit | read-only (`get_weight_unit`) | `set_weight_unit` → upserts preference | Round-trips with the Phase 2 read tool |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/mcp/read-tools.ts` | all | The exact Phase 2 pattern to mirror: `registerReadTools(server)`, per-tool `try/catch → errorResult`, `resolveUserId` + echo, `kgToDisplay` at the boundary. `write-tools.ts` is the write-side twin |
| P0 | `src/lib/mcp/result.ts` | all | `jsonResult(value)` / `errorResult(error)` — the success/error envelope; `errorResult` **genericizes non-`ToolError`** so internal errors don't leak |
| P0 | `src/lib/mcp/errors.ts` | all | `ToolError` — user-facing messages surfaced verbatim. Validation + not-found errors MUST be `ToolError` to reach the agent |
| P0 | `src/lib/workout-input.ts` | all | `parseWorkoutInput(unknown) -> WorkoutInput` (throws plain `Error`); `WorkoutInput`/`ExerciseInput`/`SetInput` shapes. **Weights validated in kg** (line 76-78) |
| P0 | `src/lib/units.ts` | 29-33 | `displayToKg(value, unit)` — convert agent-supplied display weights to kg (2dp) **before** `parseWorkoutInput` |
| P0 | `src/db/workouts.ts` | 135-231 | `saveWorkout(userId, input) -> {id}`, `updateWorkout(userId, id, input) -> {id}|null` (null = not owned), `deleteWorkout(userId, id) -> {id}[]` (empty = not owned) |
| P0 | `src/db/preferences.ts` | 24-30 | `setWeightUnit(userId, unit) -> Promise<void>` (upsert) |
| P0 | `src/lib/mcp/read-tools.test.ts` | all | The test harness + module-mock style to mirror exactly in `write-tools.test.ts` |
| P0 | `src/lib/mcp/tools.ts` | all | Where `registerWriteTools(server)` is aggregated (after `registerReadTools`) |
| P0 | `src/lib/mcp/tools.test.ts` | 33-48 | The tool-set assertion to broaden to 11 names |
| P1 | `src/app/workout/actions.ts` | 22-59 | Canonical write control flow: parse → persist → not-found-as-throw. The Clerk-gated sibling we deliberately bypass (db layer instead) |
| P1 | `src/app/workout/actions.test.ts` | all | `VALID_INPUT` shape, not-owned (`null`/`[]`) handling, "malformed input rejected before DB" test — mirror these cases |
| P2 | `src/lib/units.ts` | 1-13 | `WeightUnit`, `WEIGHT_UNITS`, `DEFAULT_WEIGHT_UNIT` (`lb`) for the `unit` arg type |

## External Documentation
No external research needed — `mcp-handler` + `@modelcontextprotocol/sdk` are wired (Phases 1–2) and the data/validation layer already exists. Tools reuse established internal patterns only.

| Topic | Source | Key Takeaway |
|---|---|---|
| MCP tool registration | Phase 1/2 in-repo (`tools.ts`, `read-tools.ts`) | `server.registerTool(name, { title, description, inputSchema }, handler)`; `inputSchema` is a plain object of zod fields |

---

## Patterns to Mirror

### TOOL_REGISTRATION (per-tool try/catch → errorResult)
```ts
// SOURCE: src/lib/mcp/read-tools.ts:22-44 (list_workouts)
server.registerTool(
  'list_workouts',
  {
    title: 'List Workouts',
    description: "Lists the user's workouts ...",
    inputSchema: { userId: z.string().optional() },
  },
  async ({ userId }) => {
    try {
      const resolved = resolveUserId(userId)
      const rows = await listWorkoutSummaries(resolved)
      return jsonResult({ userId: resolved, workouts: rows.map(/* ... */) })
    } catch (error: unknown) {
      return errorResult(error)
    }
  },
)
```

### USER_RESOLUTION (throws ToolError; surfaced past genericization)
```ts
// SOURCE: src/lib/mcp/resolve-user.ts:11-22
export function resolveUserId(argUserId?: string): string {
  const fromArg = argUserId?.trim()
  if (fromArg) return fromArg
  const fromEnv = process.env.MCP_DEV_USER_ID?.trim()
  if (fromEnv) return fromEnv
  throw new ToolError('No userId: pass a `userId` argument or set MCP_DEV_USER_ID in the environment.')
}
```

### ERROR_HANDLING (user-facing vs internal)
```ts
// SOURCE: src/lib/mcp/result.ts:21-27
export function errorResult(error: unknown) {
  if (error instanceof ToolError) {
    return { content: [{ type: 'text' as const, text: error.message }], isError: true as const }
  }
  console.error('MCP tool error:', error)              // internal — logged, hidden
  return { content: [{ type: 'text' as const, text: 'MCP tool failed' }], isError: true as const }
}
// SOURCE: src/lib/mcp/errors.ts:11-16
export class ToolError extends Error {
  constructor(message: string) { super(message); this.name = 'ToolError' }
}
```

### UNIT_CONVERSION (display → stored kg, the write direction)
```ts
// SOURCE: src/lib/units.ts:29-33
export function displayToKg(value: number, unit: WeightUnit): number {
  const kg = unit === 'lb' ? value * KG_PER_LB : value
  return Math.round(kg * 100) / 100 // sets.weight is numeric(6,2)
}
```

### VALIDATION_BOUNDARY (throws plain Error → must wrap as ToolError)
```ts
// SOURCE: src/lib/workout-input.ts:110-121
export function parseWorkoutInput(input: unknown): WorkoutInput {
  const obj = asRecord(input, 'workout input must be an object')
  if (!Array.isArray(obj.exercises) || obj.exercises.length === 0) {
    throw new Error('a workout needs at least one exercise')
  }
  const exercises = obj.exercises.map(parseExercise)
  const name = parseName(obj.name)
  return name === undefined ? { exercises } : { name, exercises }
}
// WorkoutInput: { name?: string; exercises: { wgerExerciseId: number; name: string; sets: { reps: number|null; weight: number|null }[] }[] }
// NOTE: weights are validated in KG here (line 76-78) — convert display→kg BEFORE calling.
```

### DB_WRITE_RETURN_SHAPES
```ts
// SOURCE: src/db/workouts.ts
// saveWorkout(userId, input)        -> Promise<{ id: string }>
// updateWorkout(userId, id, input)  -> Promise<{ id: string } | null>   // null = not owned / gone
// deleteWorkout(userId, id)         -> Promise<{ id: string }[]>         // [] = not owned / gone
// SOURCE: src/db/preferences.ts:25-30
// setWeightUnit(userId, unit)       -> Promise<void>                     // upsert
```

### TEST_HARNESS + MODULE_MOCK
```ts
// SOURCE: src/lib/mcp/read-tools.test.ts:4-49
vi.mock('@/db/workouts', () => ({ /* saveWorkout/updateWorkout/deleteWorkout */ vi.fn() }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn(), setWeightUnit: vi.fn() }))
function fakeServer() { /* records registerTool(name,_cfg,handler) into a Map */ }
// beforeEach: vi.clearAllMocks(); process.env.MCP_DEV_USER_ID='user_env'; getWeightUnit -> 'lb'
// Do NOT mock @/lib/workout-input or @/lib/units — exercise real validation + conversion.
```

### NOT_OWNED_AS_ERROR (control flow to mirror)
```ts
// SOURCE: src/app/workout/actions.ts:38-39, 56-57
const result = await updateWorkout(userId, id, parsed)
if (!result) throw new Error('workout not found')      // -> ToolError in MCP
const [deleted] = await deleteWorkout(userId, id)
if (!deleted) throw new Error('workout not found')      // -> ToolError in MCP
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/mcp/write-tools.ts` | CREATE | `registerWriteTools(server)` — the 4 write tools; write-side twin of `read-tools.ts`, keeps `tools.ts` small and write tests isolated |
| `src/lib/mcp/write-tools.test.ts` | CREATE | Unit tests for the 4 handlers with mocked db, real validation/conversion |
| `src/lib/mcp/tools.ts` | UPDATE | Import + call `registerWriteTools(server)` inside `registerTools` (after read tools); refresh header comment (Phase 3 lands here) |
| `src/lib/mcp/tools.test.ts` | UPDATE | Broaden the registered-tool-set assertion to the 11 names |

**Caller chain (Fact-Forcing Gate):** `write-tools.ts` imports `resolve-user.ts`, `result.ts`, `errors.ts`, `@/lib/workout-input`, `@/lib/units`, `@/db/workouts`, `@/db/preferences`. `registerWriteTools` is imported and called by `tools.ts` (`registerTools`), already wired into `src/app/api/[transport]/route.ts` via `createMcpHandler(registerTools, ...)`. No new entry point.

## NOT Building
- **Phase 4 items** — structured/typed error envelopes beyond `ToolError` + message, a `workout://{id}` MCP resource, resolved-user echo polish, and the connection doc/skill.
- **Auth / per-user security** — explicit POC decision; the endpoint stays public, target user from arg or `MCP_DEV_USER_ID`.
- **A new "append set / add exercise" partial-edit tool** — `update_workout` replaces the whole workout (mirrors `updateWorkout`, which deletes+reinserts children). Partial mutation is not in the existing data layer; out of scope.
- **Per-set unit fields** — a workout is logged in one `unit` (the resolved/overridden unit), matching the app (no per-row unit).
- **Refactoring `whoami`/`ping` or the read tools** — no drive-by changes.
- **Returning the full persisted workout tree** — `create_workout`/`update_workout` return the `workoutId`; the agent calls `get_workout` to confirm (keeps writes lean, avoids an extra read on every write).

---

## Step-by-Step Tasks

### Task 1: Write tools (`src/lib/mcp/write-tools.ts`)
- **ACTION**: Implement `registerWriteTools(server: McpServer): void` registering the four tools, each handler wrapped in `try/catch → errorResult`.
- **IMPLEMENT**:
  - Shared private helper `toKgInput(raw, unit)` — builds the kg-normalized object `parseWorkoutInput` expects:
    ```ts
    function toKgInput(
      raw: { name?: string; exercises: { wgerExerciseId: number; name: string; sets: { reps: number | null; weight: number | null }[] }[] },
      unit: WeightUnit,
    ) {
      return {
        name: raw.name,
        exercises: raw.exercises.map((e) => ({
          wgerExerciseId: e.wgerExerciseId,
          name: e.name,
          sets: e.sets.map((s) => ({
            reps: s.reps,
            weight: s.weight === null ? null : displayToKg(s.weight, unit),
          })),
        })),
      }
    }
    ```
  - Shared private helper `validate(raw, unit)` — convert then validate, re-throwing validation failures as `ToolError` so the agent sees the message:
    ```ts
    function validate(raw: Parameters<typeof toKgInput>[0], unit: WeightUnit): WorkoutInput {
      try {
        return parseWorkoutInput(toKgInput(raw, unit))
      } catch (error: unknown) {
        throw new ToolError(error instanceof Error ? error.message : 'invalid workout input')
      }
    }
    ```
  - A reusable zod field for the workout body (define once, use in create + update):
    ```ts
    const exercisesSchema = z.array(
      z.object({
        wgerExerciseId: z.number().int(),
        name: z.string(),
        sets: z.array(z.object({ reps: z.number().int().nullable(), weight: z.number().nullable() })),
      }),
    )
    const unitArg = z.enum(['kg', 'lb']).optional()
    ```
  - **`create_workout`** — `inputSchema: { name: z.string().optional(), exercises: exercisesSchema, unit: unitArg, userId: z.string().optional() }`. Resolve userId; `const unit = unitArg ?? await getWeightUnit(resolved)`; `const parsed = validate({ name, exercises }, unit)`; `const { id } = await saveWorkout(resolved, parsed)`; return `jsonResult({ userId: resolved, unit, workoutId: id })`.
  - **`update_workout`** — `inputSchema: { id: z.string(), name: z.string().optional(), exercises: exercisesSchema, unit: unitArg, userId: z.string().optional() }`. Resolve userId; resolve unit; `const parsed = validate(...)`; `const result = await updateWorkout(resolved, id, parsed)`; if `!result` → `throw new ToolError(\`Workout \${id} not found for user \${resolved}\`)`; return `jsonResult({ userId: resolved, unit, workoutId: result.id })`.
  - **`delete_workout`** — `inputSchema: { id: z.string(), userId: z.string().optional() }`. Resolve userId; `const [deleted] = await deleteWorkout(resolved, id)`; if `!deleted` → `throw new ToolError(\`Workout \${id} not found for user \${resolved}\`)`; return `jsonResult({ userId: resolved, workoutId: deleted.id, deleted: true })`.
  - **`set_weight_unit`** — `inputSchema: { unit: z.enum(['kg', 'lb']), userId: z.string().optional() }`. Resolve userId; `await setWeightUnit(resolved, unit)`; return `jsonResult({ userId: resolved, unit })`.
- **MIRROR**: TOOL_REGISTRATION, USER_RESOLUTION, ERROR_HANDLING, UNIT_CONVERSION, VALIDATION_BOUNDARY, NOT_OWNED_AS_ERROR.
- **IMPORTS**:
  ```ts
  import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
  import { z } from 'zod'
  import { resolveUserId } from './resolve-user'
  import { jsonResult, errorResult } from './result'
  import { ToolError } from './errors'
  import { parseWorkoutInput, type WorkoutInput } from '@/lib/workout-input'
  import { displayToKg, type WeightUnit } from '@/lib/units'
  import { saveWorkout, updateWorkout, deleteWorkout } from '@/db/workouts'
  import { getWeightUnit, setWeightUnit } from '@/db/preferences'
  ```
- **GOTCHA**:
  - **Convert before validate.** `parseWorkoutInput` validates weights in **kg** (`workout-input.ts:76-78`). Pass it display-unit numbers and the `MAX_WEIGHT` bound / semantics will be wrong. Always `displayToKg` (non-null only) first; never convert `reps`; pass `null` through.
  - **Wrap validation errors as `ToolError`.** `parseWorkoutInput` throws plain `Error`; `errorResult` genericizes plain errors to `"MCP tool failed"`, which would hide "a workout needs at least one exercise". The `validate()` helper re-throws as `ToolError` so the message reaches the agent.
  - **Not-owned → `ToolError`, not plain.** `updateWorkout` returns `null` and `deleteWorkout` returns `[]` when the user doesn't own the row (this is also the ownership gate). Throw `ToolError('... not found ...')` so it surfaces (mirrors `get_workout`).
  - **DB rejections stay generic.** Let real DB errors propagate to the outer `catch` → `errorResult` logs + genericizes them (don't wrap these in `ToolError`).
  - `unit` arg is a zod enum; trust it (no `isWeightUnit` re-check), consistent with Phase 2 trusting `z.number()` for ids. Resolve `unit` once and reuse for conversion + echo.
  - Don't add `.min(1)` to `exercisesSchema` — let `parseWorkoutInput` own the "at least one exercise" message (surfaced as `ToolError`).
- **VALIDATE**: `npx tsc --noEmit` clean; `npx vitest run src/lib/mcp/write-tools.test.ts`.

### Task 2: Write-tools tests (`src/lib/mcp/write-tools.test.ts`)
- **ACTION**: Unit-test all four handlers via the fake server, with mocked db modules and real validation/conversion.
- **IMPLEMENT**:
  - `vi.mock('@/db/workouts', () => ({ saveWorkout: vi.fn(), updateWorkout: vi.fn(), deleteWorkout: vi.fn() }))`; `vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn(), setWeightUnit: vi.fn() }))`. Do **not** mock `@/lib/workout-input` or `@/lib/units`.
  - Reuse the `fakeServer()` + `ToolHandler`/`ToolResult` types and `setup()`/`payload()` helpers verbatim from `read-tools.test.ts`; call `registerWriteTools(server)`.
  - `beforeEach`: `vi.clearAllMocks()`; set/restore `process.env.MCP_DEV_USER_ID = 'user_env'` (save/restore like `read-tools.test.ts`); `getWeightUnit.mockResolvedValue('lb')`.
  - A valid body fixture: `const BODY = { exercises: [{ wgerExerciseId: 1, name: 'Bench', sets: [{ reps: 5, weight: 220.5 }, { reps: null, weight: null }] }] }`.
  - Cases (AAA):
    - registers exactly `['create_workout','delete_workout','set_weight_unit','update_workout']` (sorted).
    - `create_workout` converts display→kg and calls `saveWorkout` with the kg input: assert `saveWorkout` called with `('user_env', expect.objectContaining({ exercises: [expect.objectContaining({ sets: [{ reps: 5, weight: displayToKg(220.5,'lb') }, { reps: null, weight: null }] })] }))`; returns `{ userId:'user_env', unit:'lb', workoutId:'w1' }` (mock `saveWorkout` → `{ id:'w1' }`).
    - `create_workout` with `unit:'kg'` does not convert and does **not** call `getWeightUnit`: weight stays `220.5`; assert `getWeightUnit` not called.
    - `create_workout` uses the stored unit when no `unit` arg (asserts `getWeightUnit` called with `'user_env'`).
    - `create_workout` invalid input (`{ exercises: [] }`) → `isError`, text `/at least one exercise/`, and `saveWorkout` **not** called (validation ToolError surfaced).
    - `create_workout` db rejects (`saveWorkout` → reject) → generic `isError` text `'MCP tool failed'` + `console.error` called (spy), no throw.
    - `create_workout` no user (env unset, no arg) → `isError` `/userId/`, `saveWorkout` not called.
    - `update_workout` converts + calls `updateWorkout('user_env','w1', parsed)` → `{ id:'w1' }`; returns `{ userId, unit, workoutId:'w1' }`.
    - `update_workout` not owned (`updateWorkout` → `null`) → `isError` `/not found/`.
    - `delete_workout` deletes (`deleteWorkout` → `[{ id:'w1' }]`) → returns `{ userId:'user_env', workoutId:'w1', deleted:true }`; asserts `deleteWorkout` called with `('user_env','w1')`.
    - `delete_workout` nothing deleted (`deleteWorkout` → `[]`) → `isError` `/not found/`.
    - `set_weight_unit` calls `setWeightUnit('user_env','kg')`, returns `{ userId:'user_env', unit:'kg' }`.
    - no-user gate (parameterized over `update_workout`/`delete_workout`/`set_weight_unit`): env unset → `isError` `/userId/`, primary db fn not called.
- **MIRROR**: MODULE_MOCK, TEST_HARNESS; AAA + descriptive names from `read-tools.test.ts`.
- **IMPORTS**: vitest (`describe,it,expect,vi,beforeEach,afterEach`), the mocked fns via `vi.mocked(...)`, and `displayToKg` from `@/lib/units` for the expected-kg assertion.
- **GOTCHA**: `vi.mock` is hoisted — declare mocks before importing `write-tools`. Compute expected kg with the real `displayToKg(220.5,'lb')` (≈ `100.02`), don't hardcode. Spy on `console.error` in the db-reject test to keep output clean and assert logging. For the not-owned `delete` case, mock `deleteWorkout` → `[]` (array), not `null`.
- **VALIDATE**: all cases green.

### Task 3: Aggregate into `registerTools` (`src/lib/mcp/tools.ts`)
- **ACTION**: Call `registerWriteTools(server)` from `registerTools` (after `registerReadTools`); refresh the header comment.
- **IMPLEMENT**: add `import { registerWriteTools } from './write-tools'`; after the existing `registerReadTools(server)` line, add `registerWriteTools(server)`. Update the doc comment: Phase 1 connectivity + Phase 2 read + **Phase 3 write** tools register here; Phase 4 ergonomics to follow.
- **MIRROR**: the existing `registerReadTools(server)` aggregation.
- **IMPORTS**: `./write-tools`.
- **GOTCHA**: Keep `ping`/`whoami` and the `registerReadTools` call exactly as-is (no refactor).
- **VALIDATE**: `npx vitest run src/lib/mcp/tools.test.ts`.

### Task 4: Update `tools.test.ts` tool-set assertion
- **ACTION**: Broaden the `registers the connectivity and read tools` assertion to include the four write tools.
- **IMPLEMENT**: rename to `registers the connectivity, read, and write tools` and assert the sorted set:
  ```ts
  expect([...tools.keys()].sort()).toEqual([
    'create_workout', 'delete_workout', 'get_last_performance', 'get_weight_unit',
    'get_workout', 'list_workouts', 'ping', 'search_exercises', 'set_weight_unit',
    'update_workout', 'whoami',
  ])
  ```
  Leave the ping/whoami behavior tests untouched. (Importing `tools.ts` now also imports `write-tools.ts` → `@/lib/workout-input` (pure) + db modules; construction-only, no queries; safe under `vitest.setup.ts`.)
- **MIRROR**: existing assertion style.
- **IMPORTS**: unchanged.
- **GOTCHA**: `tools.test.ts` does **not** invoke write handlers, so it needs no db mocks; only the name-set assertion changes.
- **VALIDATE**: `npx vitest run src/lib/mcp` all green.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| registers the 4 write tools | — | sorted `['create_workout','delete_workout','set_weight_unit','update_workout']` | — |
| `create_workout` display→kg | body w/ 220.5 lb, unit `lb` | `saveWorkout` called w/ `weight=displayToKg(220.5,'lb')`; returns `{userId,unit,workoutId}` | conversion |
| `create_workout` unit override | unit `kg` | weight `220.5` verbatim; `getWeightUnit` not called | identity |
| `create_workout` stored unit | no unit arg | `getWeightUnit` called with resolved id | default |
| `create_workout` invalid | `{exercises:[]}` | `isError`, `/at least one exercise/`, no `saveWorkout` | validation |
| `create_workout` null set | `{reps:null,weight:null}` | passed through as `null` | blanks |
| `create_workout` db rejects | `saveWorkout` throws | `isError:'MCP tool failed'` + logged | failure |
| `create_workout` no user | env unset, no arg | `isError`, `/userId/`, no `saveWorkout` | unresolved user |
| `update_workout` success | body + id | `updateWorkout(id,parsed)`→`{id}`; returns `workoutId` | — |
| `update_workout` not owned | `updateWorkout`→`null` | `isError`, `/not found/` | ownership |
| `delete_workout` success | id | `deleteWorkout`→`[{id}]`; `{deleted:true}` | — |
| `delete_workout` not owned | `deleteWorkout`→`[]` | `isError`, `/not found/` | ownership |
| `set_weight_unit` | unit `kg` | `setWeightUnit(id,'kg')`; `{userId,unit:'kg'}` | — |
| any write tool, no id/env | env unset, no arg | `isError`, `/userId/`, db not called | unresolved user |

### Edge Cases Checklist
- [x] Empty input (no exercises → validation error)
- [x] Invalid/absent user (no arg, no env → `isError`)
- [x] Null fields (reps/weight passthrough)
- [x] Not found / not owned (update→null, delete→[])
- [x] Backend failure (db rejects → `isError`, not 500)
- [x] Unit conversion + override (lb→kg, kg identity)
- [ ] Concurrent access — N/A (each tool call is one transaction in the db layer)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors.

```bash
npx eslint src/lib/mcp/*.ts
```
EXPECT: No lint errors in the changed files. (Repo-wide `npm run lint` reports pre-existing errors only under `.claude/worktrees/**` build artifacts — unrelated.)

### Unit Tests (affected area)
```bash
npx vitest run src/lib/mcp
```
EXPECT: All MCP tests pass (result, errors-via-consumers, read-tools, write-tools, tools, resolve-user).

### Full Test Suite
```bash
npx vitest run --exclude '**/.claude/worktrees/**' --exclude '**/node_modules/**'
```
EXPECT: No regressions. (Plain `npm test` also scans the stray `.claude/worktrees/` worktree, which fails independently of this change.)

### Build Check
```bash
npm run build
```
EXPECT: Build succeeds; `/api/[transport]` route present.

### Manual / Live Validation (optional, mirrors PRD success signal)
```bash
# With MCP_DEV_USER_ID set to a real Clerk user id:
npm run dev
# Connect an MCP client to http://localhost:3000/api/mcp and call:
#   create_workout { "exercises": [{ "wgerExerciseId": 73, "name": "Squat",
#       "sets": [{ "reps": 5, "weight": 225 }] }] }   -> { userId, unit, workoutId }
#   get_workout { "id": "<workoutId>" }               -> the persisted set tree (weights in unit)
#   update_workout { "id": "<workoutId>", "exercises": [...] } -> { workoutId }
#   set_weight_unit { "unit": "kg" }                  -> { userId, unit: "kg" }
#   delete_workout { "id": "<workoutId>" }            -> { deleted: true }
```
- [ ] `create_workout` inserts the correct workout→exercises→sets tree in Postgres (PRD success metric); latency < 500 ms warm.

---

## Acceptance Criteria
- [ ] Four write tools registered and listed by a connected MCP client (11 tools total).
- [ ] `create_workout` validates via `parseWorkoutInput` and persists via `saveWorkout`; agent-supplied weights converted display→kg.
- [ ] `update_workout`/`delete_workout` are ownership-gated, returning a `ToolError` (`/not found/`) when the row isn't owned.
- [ ] `set_weight_unit` upserts the user's unit and round-trips with `get_weight_unit`.
- [ ] Validation errors reach the agent (surfaced as `ToolError`); internal DB errors are logged + genericized.
- [ ] Every tool resolves `userId` via `resolveUserId` and echoes it back.
- [ ] All validation commands pass; tests written and green; no type/lint errors.

## Completion Checklist
- [ ] Code follows discovered patterns (registration, user resolution, unit conversion, error handling).
- [ ] Validation errors wrapped as `ToolError`; not-owned → `ToolError`; DB errors left to genericize.
- [ ] No hardcoded values (units via `displayToKg`, ids via `resolveUserId`).
- [ ] Tests follow `fakeServer` + module-mock patterns; AAA naming; real validation/conversion exercised.
- [ ] No drive-by refactor of Phase 1/2 tools.
- [ ] Self-contained — no codebase search needed during implementation.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Weights passed to `parseWorkoutInput` in display unit (not kg) → wrong bound/values | M | M | `validate()` converts via `displayToKg` before parse; tests assert the kg value reaching `saveWorkout` |
| Validation error genericized → agent can't tell what was wrong | M | M | `validate()` re-throws `parseWorkoutInput`'s message as `ToolError`; test asserts `/at least one exercise/` surfaces |
| `update`/`delete` not-owned returns thrown 500 instead of clean error | L | M | Mirror actions.ts: `null`/`[]` → `ToolError('... not found ...')`; tests cover both |
| Importing `write-tools.ts` into `tools.test.ts` pulls in db client at import time | L | M | postgres-js opens no socket until a query runs; `vitest.setup.ts` sets dummy `DATABASE_URL`; construction-only |
| zod type-mismatch surfaces as a raw SDK error, not a `ToolError` | L | L | Acceptable for POC; semantic errors (empty/over-range) still surface as `ToolError` via `parseWorkoutInput` |

## Decisions Log
| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| Weight basis on write | Agent supplies display unit; convert via `displayToKg` | Require kg | Symmetric with the read tools (which return + echo the user's unit); `unit` arg lets the agent be explicit |
| `unit` argument | Optional; default to stored `getWeightUnit` | Required arg / always stored | "add my workout" needs no unit; explicit override removes the stateful dependency on a prior `get_weight_unit` call |
| Validation reuse | `parseWorkoutInput` (existing trust boundary), errors → `ToolError` | New zod schema in the tool | One source of truth for the persisted shape; matches `saveWorkoutAction`; kg bound already there |
| `update_workout` semantics | Full replace (wraps `updateWorkout`) | Partial/patch edits | The db layer replaces children atomically; partial edit isn't a supported operation |
| Write return payload | `{ userId, unit, workoutId }` (+`deleted` for delete) | Full workout tree | Lean writes; agent calls `get_workout` to confirm — avoids an extra read per write |
| File layout | `write-tools.ts` + `write-tools.test.ts`, aggregated by `registerTools` | Inline in `tools.ts` / fold into `read-tools.ts` | Keeps files small/focused; write-test db mocks stay isolated from read/tools tests |

## Notes
- `MCP_DEV_USER_ID` already documented (Phase 1). No new env vars, no schema changes.
- Phase 3 completes the MoSCoW "Must" + "Should" write surface; Phase 4 (ergonomics: structured errors, `workout://{id}` resource, connection doc) builds on Phases 2–3.
- This phase touches a disjoint tool set from Phase 2 over the same data layer — it could have run concurrently with Phase 2; it now lands on top of the committed read tools.
