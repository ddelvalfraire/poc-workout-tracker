# Plan: MCP Read Tools (Phase 2)

## Summary
Add five read-only MCP tools to the existing in-app MCP server so a connected agent can review a user's training and resolve exercise names: `list_workouts`, `get_workout`, `search_exercises`, `get_last_performance`, and `get_weight_unit`. Each tool wraps an existing `src/db/*` / `src/lib/wger.ts` function directly, renders weights in the user's stored unit, and echoes the resolved `userId` back so the agent can confirm whose data it read.

## User Story
As a lifter dogfooding the app through an AI agent,
I want the agent to see my workout history and find exercises by name,
So that I can review training and log correctly by talking instead of tapping.

## Problem → Solution
The MCP endpoint (Phase 1) is live and connectable but exposes only `ping`/`whoami` — an agent can't read any training data → Five read tools wrap the existing user-scoped data layer, returning history, a single workout, catalog matches, last performance of an exercise, and the user's weight unit.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/mcp-agent-server.prd.md`
- **PRD Phase**: Phase 2 — Read tools
- **Estimated Files**: 6 (3 new, 3 edited)

---

## UX Design

### Before / After
Internal/agent-facing change — no end-user UI. The "user" is an MCP client (e.g. Claude remote MCP). Before: connecting lists only `ping`, `whoami`. After: the agent can call read tools and get structured JSON it can reason over.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| MCP tool list | `ping`, `whoami` | + `list_workouts`, `get_workout`, `search_exercises`, `get_last_performance`, `get_weight_unit` | Registered via a new `registerReadTools` aggregated into `registerTools` |
| Reading history | impossible via agent | `list_workouts` → summaries; `get_workout` → full set tree | Weights in the user's unit |
| Resolving exercises | impossible via agent | `search_exercises` → wger catalog matches | No `userId` needed (public reference data) |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/mcp/tools.ts` | all | The registration pattern to extend; `registerTool(name, config, handler)` shape, error-as-`isError` convention |
| P0 | `src/lib/mcp/tools.test.ts` | all | The `fakeServer()` test harness to reuse; the exact tool-set assertion to update |
| P0 | `src/lib/mcp/resolve-user.ts` | all | The `resolveUserId(argUserId?)` boundary every user-scoped tool funnels through |
| P0 | `src/db/workouts.ts` | 24-133 | Signatures + return shapes of `listWorkoutSummaries`, `getWorkoutDetail`, `getLastPerformance` (weights stored in **kg**) |
| P0 | `src/db/preferences.ts` | 14-22 | `getWeightUnit(userId)` → `WeightUnit`, default `lb` |
| P0 | `src/lib/wger.ts` | 45-50, 227-240 | `searchExercises({search?,category?,limit?})` → `Exercise[]`; no `userId` |
| P0 | `src/lib/units.ts` | all | `kgToDisplay(weightKg, unit)` — convert stored kg to the user's unit at the boundary |
| P1 | `src/app/workout/[id]/page.tsx` | 18-66, 100-145 | Canonical consumer: fetches detail + unit, converts weights, derives est-1RM via `bestSet` |
| P1 | `src/lib/one-rep-max.ts` | all | `bestSet(sets)` → `{reps, weightKg, e1rm}` for the optional per-exercise est-1RM in `get_workout` |
| P1 | `src/db/last-performance.test.ts` | all | db-mocking style if needed; but prefer module-level `vi.mock` (see below) |
| P2 | `src/app/api/exercises/route.test.ts` | 1-40 | The `vi.mock(module, () => ({ fn: vi.fn() }))` + `vi.mocked()` pattern to mirror in `read-tools.test.ts` |
| P2 | `src/lib/format.ts` | 6-34 | How the app renders weight/e1rm in-unit (we return numbers, not formatted strings) |

## External Documentation
No external research needed — `mcp-handler` + `@modelcontextprotocol/sdk` are already wired in Phase 1 (`createMcpHandler`, `server.registerTool`). Tools reuse established internal patterns only.

---

## Patterns to Mirror

### TOOL_REGISTRATION
```ts
// SOURCE: src/lib/mcp/tools.ts:25-42
server.registerTool(
  'whoami',
  {
    title: 'Who Am I',
    description: 'Returns the resolved target userId ...',
    inputSchema: { userId: z.string().optional() },
  },
  async ({ userId }) => {
    try {
      const resolved = resolveUserId(userId)
      return { content: [{ type: 'text', text: JSON.stringify({ userId: resolved }) }] }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to resolve userId'
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  },
)
```
Note: `inputSchema` is a **plain object of zod fields** (not `z.object(...)`). An empty schema is `{}`.

### USER_RESOLUTION
```ts
// SOURCE: src/lib/mcp/resolve-user.ts:11-19
export function resolveUserId(argUserId?: string): string {
  const fromArg = argUserId?.trim()
  if (fromArg) return fromArg
  const fromEnv = process.env.MCP_DEV_USER_ID?.trim()
  if (fromEnv) return fromEnv
  throw new Error('No userId: pass a `userId` argument or set MCP_DEV_USER_ID in the environment.')
}
```

### UNIT_CONVERSION (kg stored → user unit at the boundary)
```ts
// SOURCE: src/lib/units.ts:25-27 ; consumed in src/app/workout/[id]/page.tsx:20-23
export function kgToDisplay(weightKg: number, unit: WeightUnit): number {
  return unit === 'lb' ? roundForDisplay(weightKg / KG_PER_LB) : weightKg
}
```

### TEST_HARNESS (fake MCP server, invoke handlers directly)
```ts
// SOURCE: src/lib/mcp/tools.test.ts:13-21
function fakeServer(): { server: McpServer; tools: Map<string, ToolHandler> } {
  const tools = new Map<string, ToolHandler>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  }
  return { server: server as unknown as McpServer, tools }
}
```

### MODULE_MOCK (mirror for db/wger in read-tools.test.ts)
```ts
// SOURCE: src/app/api/exercises/route.test.ts:6-9
vi.mock('@/lib/wger', () => ({ searchExercises: vi.fn(), getAllExercises: vi.fn() }))
const mockedSearch = vi.mocked(searchExercises)
```

### DB_READ_RETURN_SHAPES
```ts
// SOURCE: src/db/workouts.ts
// listWorkoutSummaries(userId) -> { id, name: string|null, startedAt: Date, exerciseCount: number, setCount: number }[]
// getWorkoutDetail(userId, id) -> (workout + exercises[{id,wgerExerciseId,name,position, sets:[{id,setNumber,reps,weight}]}]) | undefined   // weights in kg
// getLastPerformance(userId, wgerExerciseId, excludeWorkoutId?) -> { performedAt: Date, sets:[{reps,weight}] } | null   // weights in kg
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/mcp/result.ts` | CREATE | Small shared helpers: `jsonResult(value)` and `errorResult(error)` — DRY the repeated `{ content: [{ type:'text', text }], isError? }` shaping across 5 tools |
| `src/lib/mcp/result.test.ts` | CREATE | Unit-test the helpers (error narrowing, JSON shaping) |
| `src/lib/mcp/read-tools.ts` | CREATE | `registerReadTools(server)` — the 5 read tools; keeps `tools.ts` small and read-tool tests isolated |
| `src/lib/mcp/read-tools.test.ts` | CREATE | Unit tests for the 5 handlers with mocked db/wger |
| `src/lib/mcp/tools.ts` | UPDATE | Import + call `registerReadTools(server)` inside `registerTools`; update header comment (Phase 2 lands here) |
| `src/lib/mcp/tools.test.ts` | UPDATE | Update the registered-tool-set assertion to include the 5 read tool names |

**Caller chain (Fact-Forcing Gate #1):** `result.ts` is imported by `read-tools.ts`; `read-tools.ts` (`registerReadTools`) is imported and called by `tools.ts` (`registerTools`), which is already imported by `src/app/api/[transport]/route.ts` (`createMcpHandler(registerTools, ...)`). No new entry point — the existing route handler reaches the new tools transitively.

## NOT Building
- **Write tools** (`create_workout`, `set_weight_unit`, `update_workout`, `delete_workout`) — Phase 3.
- **`get_exercise_history` as a distinct tool** — `getExerciseHistoryBefore` is an internal PR-comparison corpus keyed on a `before` timestamp, not a clean standalone agent surface. The PRD's "`get_exercise_history`/`last_performance`" is satisfied by `get_last_performance` (wraps `getLastPerformance`), the genuinely useful "what did I do last time" capability. (Decision logged below.)
- **A `list_workouts` over `listWorkouts`** — `listWorkoutSummaries` supersedes the bare `listWorkouts` (adds counts in one query); we expose the summary form.
- **`workout://{id}` MCP resource** + connection doc — Phase 4.
- **Structured/typed error envelopes beyond `isError` + message** — Phase 4 ergonomics. Phase 2 returns a plain text message with `isError: true`.
- **Refactoring `whoami`** to use the new `result.ts` helpers — out of scope; avoid a drive-by diff (noted as a Phase 4 unification opportunity).
- **`outputSchema` / structured content blocks** — return JSON-as-text, matching the existing `whoami` convention.

---

## Step-by-Step Tasks

### Task 1: Result helpers (`src/lib/mcp/result.ts`)
- **ACTION**: Create the shared tool-result helpers.
- **IMPLEMENT**:
  ```ts
  /** A successful MCP tool result carrying `value` as JSON text. */
  export function jsonResult(value: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
  }
  /** An MCP error result (isError) with a safe, narrowed message. */
  export function errorResult(error: unknown) {
    const message = error instanceof Error ? error.message : 'MCP tool failed'
    return { content: [{ type: 'text' as const, text: message }], isError: true as const }
  }
  ```
- **MIRROR**: TOOL_REGISTRATION (the `{ content: [{ type:'text', text }] }` / `isError` shape; error narrowing copied from `whoami`).
- **IMPORTS**: none.
- **GOTCHA**: Use `as const` on `type: 'text'` and `isError: true` so the literal types satisfy the SDK's `CallToolResult` content union (avoids a `string`-widened `type`).
- **VALIDATE**: `npx vitest run src/lib/mcp/result.test.ts`.

### Task 2: Result helper tests (`src/lib/mcp/result.test.ts`)
- **ACTION**: Cover both helpers.
- **IMPLEMENT**: AAA cases — `jsonResult({a:1})` → `content[0].text === '{"a":1}'`, no `isError`; `errorResult(new Error('boom'))` → text `'boom'`, `isError === true`; `errorResult('weird')` → text `'MCP tool failed'`, `isError === true`.
- **MIRROR**: Test naming/AAA from `src/lib/mcp/resolve-user.test.ts`.
- **IMPORTS**: `import { describe, it, expect } from 'vitest'`; `import { jsonResult, errorResult } from './result'`.
- **GOTCHA**: none.
- **VALIDATE**: tests pass.

### Task 3: Read tools (`src/lib/mcp/read-tools.ts`)
- **ACTION**: Implement `registerReadTools(server: McpServer): void` registering the five tools.
- **IMPLEMENT** (one `server.registerTool` per tool, each handler wrapped in try/catch → `errorResult`):
  - **`list_workouts`** — `inputSchema: { userId: z.string().optional() }`. Resolve userId, `const rows = await listWorkoutSummaries(userId)`, return `jsonResult({ userId, workouts: rows.map(r => ({ ...r, startedAt: r.startedAt.toISOString() })) })`.
  - **`get_workout`** — `inputSchema: { id: z.string(), userId: z.string().optional() }`. Resolve userId; `const [workout, unit] = await Promise.all([getWorkoutDetail(userId, id), getWeightUnit(userId)])`. If `!workout` → `errorResult(new Error(\`Workout \${id} not found for user \${userId}\`))`. Else build a fresh object: map exercises to `{ id, wgerExerciseId, name, position, sets: sets.map(s => ({ setNumber: s.setNumber, reps: s.reps, weight: s.weight === null ? null : kgToDisplay(s.weight, unit) })), estimated1RM: e1rmFor(exercise.sets, unit) }`; return `jsonResult({ userId, unit, workout: { id, name, startedAt: startedAt.toISOString(), exercises } })`.
  - **`search_exercises`** — `inputSchema: { search: z.string().optional(), category: z.string().optional(), limit: z.number().int().positive().optional() }`. **No userId.** `const exercises = await searchExercises({ search, category, limit })`; return `jsonResult({ count: exercises.length, exercises })`.
  - **`get_last_performance`** — `inputSchema: { wgerExerciseId: z.number().int(), userId: z.string().optional(), excludeWorkoutId: z.string().optional() }`. Resolve userId; `const [last, unit] = await Promise.all([getLastPerformance(userId, wgerExerciseId, excludeWorkoutId), getWeightUnit(userId)])`. Return `jsonResult({ userId, unit, wgerExerciseId, lastPerformance: last === null ? null : { performedAt: last.performedAt.toISOString(), sets: last.sets.map(s => ({ reps: s.reps, weight: s.weight === null ? null : kgToDisplay(s.weight, unit) })) } })`.
  - **`get_weight_unit`** — `inputSchema: { userId: z.string().optional() }`. Resolve userId; `const unit = await getWeightUnit(userId)`; return `jsonResult({ userId, unit })`.
  - Add a small private helper `e1rmFor(sets, unit)`: `const best = bestSet(sets); return best === null ? null : kgToDisplay(best.e1rm, unit)`.
- **MIRROR**: TOOL_REGISTRATION, USER_RESOLUTION, UNIT_CONVERSION.
- **IMPORTS**:
  ```ts
  import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
  import { z } from 'zod'
  import { resolveUserId } from './resolve-user'
  import { jsonResult, errorResult } from './result'
  import { listWorkoutSummaries, getWorkoutDetail, getLastPerformance } from '@/db/workouts'
  import { getWeightUnit } from '@/db/preferences'
  import { searchExercises } from '@/lib/wger'
  import { kgToDisplay } from '@/lib/units'
  import { bestSet } from '@/lib/one-rep-max'
  ```
- **GOTCHA**:
  - Weights are stored in **kg**; convert with `kgToDisplay` only when non-null. **Never** convert `reps`. Pass `null` through untouched.
  - `resolveUserId` **throws** when no id/env — the try/catch turns that into `errorResult` (don't let it escape as a 500).
  - `getWorkoutDetail` returns `undefined` (not null) on miss/not-owned — treat falsy as not-found; this is also the ownership gate (it filters by `userId`).
  - `Date` fields (`startedAt`, `performedAt`) must be `.toISOString()`'d — raw `Date` JSON-stringifies inconsistently across the wire.
  - `search_exercises` must **not** call `resolveUserId` — exercise data is public reference data (mirrors `/api/exercises` having no user scoping on the catalog).
- **VALIDATE**: `npx tsc --noEmit` clean; `npx vitest run src/lib/mcp/read-tools.test.ts`.

### Task 4: Read-tools tests (`src/lib/mcp/read-tools.test.ts`)
- **ACTION**: Unit-test all five handlers via the fake server, with mocked db/wger modules.
- **IMPLEMENT**:
  - `vi.mock('@/db/workouts', () => ({ listWorkoutSummaries: vi.fn(), getWorkoutDetail: vi.fn(), getLastPerformance: vi.fn() }))`, `vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))`, `vi.mock('@/lib/wger', () => ({ searchExercises: vi.fn() }))`. Do **not** mock `@/lib/units` or `@/lib/one-rep-max` — exercise the real conversion/e1rm math.
  - Reuse the `fakeServer()` + `ToolHandler`/`ToolResult` types verbatim from `tools.test.ts`; call `registerReadTools(server)`.
  - `beforeEach`: `vi.clearAllMocks()`, set `process.env.MCP_DEV_USER_ID` (save/restore in before/after like `tools.test.ts:24-31`); `getWeightUnit` default `mockResolvedValue('lb')`.
  - Cases (AAA):
    - registers exactly `['get_last_performance','get_weight_unit','get_workout','list_workouts','search_exercises']` (sorted).
    - `list_workouts` maps summaries + ISO `startedAt` + echoes `userId`; asserts `listWorkoutSummaries` called with resolved id.
    - `list_workouts` uses explicit `userId` arg over env.
    - `get_workout` converts kg→lb (e.g. stored `100` kg, unit `lb` → `220.5`), passes `reps`/`null` weight through, includes `estimated1RM` (5 reps @ 100 kg → e1rm 116.67 kg → `kgToDisplay(...,'lb')`), and `unit:'lb'`.
    - `get_workout` returns `isError` text matching `/not found/` when `getWorkoutDetail` resolves `undefined`.
    - `get_workout` with `unit:'kg'` returns weights verbatim (no rounding) — set `getWeightUnit` → `'kg'`.
    - `search_exercises` returns `{count, exercises}` and does **not** read `MCP_DEV_USER_ID` (works with env unset).
    - `get_last_performance` maps sets in unit, ISO `performedAt`; returns `lastPerformance: null` when history is null; forwards `excludeWorkoutId` to `getLastPerformance`.
    - `get_weight_unit` returns `{ userId, unit }`.
    - error path: make `listWorkoutSummaries` reject → handler returns `isError: true` (no throw).
    - no-user path: unset env + no arg → `list_workouts` returns `isError` matching `/userId/`, and the db fn is **not** called.
- **MIRROR**: MODULE_MOCK, TEST_HARNESS; AAA + descriptive names from `resolve-user.test.ts`.
- **IMPORTS**: vitest + the mocked fns via `vi.mocked(...)`.
- **GOTCHA**: `vi.mock` is hoisted — declare mocks before importing `read-tools`. Mocked async fns need `mockResolvedValue`. Compute the expected lb value with the real `kgToDisplay` (don't hardcode a rounding you might get wrong): import it in the test for the assertion, or assert against `kgToDisplay(100,'lb')`.
- **VALIDATE**: all cases green.

### Task 5: Aggregate into `registerTools` (`src/lib/mcp/tools.ts`)
- **ACTION**: Call `registerReadTools(server)` from `registerTools`; refresh the header comment.
- **IMPLEMENT**: add `import { registerReadTools } from './read-tools'`; at the end of `registerTools`, after `whoami`, add `registerReadTools(server)`. Update the doc comment: Phase 1 connectivity tools **plus** Phase 2 read tools now register here; Phase 3 write tools to follow.
- **MIRROR**: existing file structure.
- **IMPORTS**: `./read-tools`.
- **GOTCHA**: Keep `ping`/`whoami` exactly as-is (no refactor to the new helpers in this PR).
- **VALIDATE**: `npx vitest run src/lib/mcp/tools.test.ts`.

### Task 6: Update `tools.test.ts` tool-set assertion
- **ACTION**: The `registers the ping and whoami tools` test asserts an exact `['ping','whoami']`; broaden it.
- **IMPLEMENT**: rename to `registers the connectivity and read tools` and assert the sorted set `['get_last_performance','get_weight_unit','get_workout','list_workouts','ping','search_exercises','whoami']`. Leave the ping/whoami behavior tests untouched. (Importing `tools.ts` now transitively imports db/wger modules — safe: construction only, no queries; `vitest.setup.ts` provides dummy `DATABASE_URL` and `getRedis()` returns `null` without creds.)
- **MIRROR**: existing assertion style.
- **IMPORTS**: unchanged.
- **GOTCHA**: `tools.test.ts` does **not** invoke read handlers, so it needs no db/wger mocks; only the name-set assertion changes.
- **VALIDATE**: `npx vitest run src/lib/mcp` all green.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `list_workouts` maps + ISO + echoes user | summaries w/ `Date` | `{userId, workouts:[{...,startedAt:ISO}]}` | — |
| `get_workout` kg→lb + e1rm + unit | detail (100 kg), unit `lb` | weight `220.5`, `estimated1RM` in lb, `unit:'lb'` | conversion |
| `get_workout` kg verbatim | detail (100 kg), unit `kg` | weight `100` | identity |
| `get_workout` not found | `getWorkoutDetail`→`undefined` | `isError`, `/not found/` | not-found |
| `get_workout` null weight/reps | set `{reps:null,weight:null}` | passed through as `null` | blanks |
| `search_exercises` no user needed | `{search:'bench'}`, env unset | `{count, exercises}` | no auth |
| `get_last_performance` maps in unit | last (95 kg), unit `lb` | `sets[].weight` in lb, ISO `performedAt` | — |
| `get_last_performance` no history | `getLastPerformance`→`null` | `lastPerformance:null` | empty |
| `get_last_performance` exclude fwd | `excludeWorkoutId:'w1'` | fn called with `'w1'` | passthrough |
| `get_weight_unit` | env user, unit `kg` | `{userId, unit:'kg'}` | — |
| any tool, db rejects | fn throws | `isError:true`, no throw | failure |
| any user-scoped tool, no id/env | env unset, no arg | `isError`, `/userId/`, db **not** called | unresolved user |

### Edge Cases Checklist
- [x] Empty input (search with no filters; workout with no sets/exercises)
- [x] Invalid/absent user (no arg, no env → `isError`)
- [x] Null fields (reps/weight/name passthrough)
- [x] Not found (get_workout on missing/unowned id)
- [x] Backend failure (db/wger rejects → `isError`, not 500)
- [ ] Concurrent access — N/A (read-only, stateless handlers)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors.

```bash
npm run lint
```
EXPECT: No lint errors.

### Unit Tests (affected area)
```bash
npx vitest run src/lib/mcp
```
EXPECT: All MCP tests pass (result, read-tools, tools, resolve-user).

### Full Test Suite
```bash
npm test
```
EXPECT: No regressions.

### Manual / Live Validation (optional, mirrors PRD success signal)
```bash
# With MCP_DEV_USER_ID set to a real Clerk user id that has workouts:
npm run dev
# Then connect an MCP client to http://localhost:3000/api/mcp and call:
#   list_workouts {}            -> recent workouts with counts
#   get_workout { "id": "<id from list>" } -> set tree, weights in the user's unit
#   search_exercises { "search": "bench" } -> catalog matches
#   get_last_performance { "wgerExerciseId": 73 } -> last sets for that exercise
#   get_weight_unit {}          -> { userId, unit }
```
- [ ] Each tool returns correct data for a known user; latency < 500 ms warm (PRD metric).

---

## Acceptance Criteria
- [ ] Five read tools registered and listed by a connected MCP client.
- [ ] Weights returned in the user's stored unit (kg verbatim, lb rounded 1dp).
- [ ] Every user-scoped tool resolves `userId` via `resolveUserId` and echoes it back.
- [ ] `search_exercises` works with no `userId`/env set.
- [ ] All validation commands pass; tests written and green; no type/lint errors.

## Completion Checklist
- [ ] Code follows discovered patterns (registration, user resolution, unit conversion).
- [ ] Errors handled per codebase style — thrown errors become `isError` results, never uncaught.
- [ ] Tests follow the `fakeServer` + module-mock patterns; AAA naming.
- [ ] No hardcoded values (units via `kgToDisplay`, ids via `resolveUserId`).
- [ ] No drive-by refactor of Phase 1 tools.
- [ ] Self-contained — no codebase search needed during implementation.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Importing `read-tools.ts` into `tools.test.ts` pulls in the db client at import time | L | M | `vitest.setup.ts` already sets dummy `DATABASE_URL`; postgres-js opens no socket until a query runs; `getRedis()` returns null without creds — import is side-effect-free |
| Returning weights in display unit loses canonical kg for the agent | L | L | Mirrors the app/PRD ("weights rendered in the user's unit"); `unit` is echoed in every payload so the agent knows the basis |
| `inputSchema` typed as `z.object(...)` instead of a field map | L | M | Plan pins the field-map shape (matches `whoami`); `tsc` would catch it |
| Tool name drift vs. PRD ("get_exercise_history") | L | L | Decision logged: `get_last_performance` satisfies the slash-named requirement; noted in NOT Building |

## Decisions Log
| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| Exercise-history tool | `get_last_performance` (→ `getLastPerformance`) | `get_exercise_history` (→ `getExerciseHistoryBefore`) | `getExerciseHistoryBefore` needs a `before` timestamp and returns a flat PR-comparison corpus — not a clean agent surface. Last-performance answers "what did I do last time," the real agent need. |
| `list_workouts` source | `listWorkoutSummaries` | `listWorkouts` | Summary adds exercise/set counts in one query; supersedes the bare list. |
| Weight basis in payloads | User's display unit + explicit `unit` field | Raw kg | Matches the app and PRD; `unit` echoed so the agent isn't guessing. |
| File layout | `read-tools.ts` + `result.ts`, aggregated by `registerTools` | Inline all tools in `tools.ts` | Keeps files small/focused and read-tool tests isolated (db/wger mocks don't bleed into `tools.test.ts`). |
| `get_workout` est-1RM | Include per-exercise `estimated1RM` (best set, in unit) | Omit (agent derives) | Mirrors the live detail view; cheap, genuinely useful for review. |

## Notes
- `MCP_DEV_USER_ID` already documented in `.env.example` (Phase 1). No new env vars.
- Phase 4 will unify `whoami` onto `result.ts` helpers and add structured errors + a `workout://{id}` resource + connection doc; deliberately deferred here.
- This phase can run concurrently with Phase 3 (write tools) — they touch disjoint tool sets over the same data layer.
