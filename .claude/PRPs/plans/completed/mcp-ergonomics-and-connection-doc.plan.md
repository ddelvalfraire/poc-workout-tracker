# Plan: MCP Ergonomics + Connection Doc (Phase 4)

## Summary
Round out the MCP agent server with the two Phase 4 items that aren't already done: a read-only `workout://{id}` MCP **resource** (an addressable handle for a single workout, mirroring `get_workout`'s payload) and a concise **connection doc** in the README so a fresh agent can connect and run a read→create→read loop unaided. The other Phase 4 "polish" bullets (structured tool errors, resolved-user echo, `userId` arg/env resolution) already shipped in Phases 2–3 and need no work.

## User Story
As a lifter dogfooding the app through an MCP client, I want a fresh agent to connect to `/api/mcp` and address a single workout as a resource, so I can wire up Claude (or any MCP client) and review/log training conversationally using only the project's docs.

## Problem → Solution
Tools exist and work, but (a) there's no MCP *resource* surface — an agent can only fetch a workout via a tool call, not reference it as a stable `workout://{id}` URI — and (b) the README is still create-next-app boilerplate, so connecting a client requires reading the source. → Add a `workout://{id}` resource that reuses the existing workout projection, and a focused "MCP Agent Server" README section documenting the endpoint, the env-var user, the tool/resource surface, and a worked connect-and-use example.

## Metadata
- **Complexity**: Small
- **Source PRD**: `.claude/PRPs/prds/mcp-agent-server.prd.md`
- **PRD Phase**: Phase 4 — Ergonomics + connection doc
- **Estimated Files**: 6 (2 created, 4 updated)

---

## UX Design

### Before
```
Agent (MCP client) ── tools only ──▶ /api/mcp
   • get_workout(id) → JSON          (no stable per-workout handle)
   • README = create-next-app boilerplate → connecting requires reading source
```

### After
```
Agent (MCP client) ── tools + resources ──▶ /api/mcp
   • get_workout(id) → JSON          (unchanged)
   • resource  workout://{id} → same JSON, addressable URI
   • README "MCP Agent Server" section → connect Claude, set MCP_DEV_USER_ID,
     worked search→create→get loop
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Single workout access | `get_workout` tool only | `get_workout` tool **and** `workout://{id}` resource | Resource returns the identical payload; resources are read-only by MCP semantics |
| Onboarding a client | Read `src/app/api/[transport]/route.ts` to find the URL | README "MCP Agent Server" section | Endpoint, no-auth warning, env user, tool list, example |
| Resource user scope | n/a | Resolved from `MCP_DEV_USER_ID` (no arg in a resource URI) | Documented; consistent with the POC env-default model |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 (critical) | `src/lib/mcp/read-tools.ts` | 46-90, 174-181 | `get_workout` handler + `e1rmFor` — the exact projection the resource must reuse; this is what we extract |
| P0 (critical) | `src/lib/mcp/tools.ts` | all (49 lines) | Registration entry point; add `registerResources(server)` here |
| P0 (critical) | `src/lib/mcp/write-tools.test.ts` | 1-49 | Canonical test scaffold: `vi.mock` db, `fakeServer`, `setup`, `payload` helpers to mirror |
| P1 (important) | `src/lib/mcp/resolve-user.ts` | all (23 lines) | `resolveUserId` — the resource resolves its user via this (no-arg → env) |
| P1 (important) | `src/lib/mcp/result.ts` + `errors.ts` | all | `ToolError`/`errorResult` split; the resource needs the *same* leak-safe philosophy but throws instead of returning `isError` |
| P1 (important) | `src/lib/mcp/tools.test.ts` | 8-21, 33-52 | `fakeServer` here records only `registerTool`; must gain a `registerResource` recorder + a registration assertion |
| P2 (reference) | `src/db/workouts.ts` | 119-133 | `getWorkoutDetail(userId, id)` contract + `WorkoutDetail` type the resource reads |
| P2 (reference) | `src/app/api/[transport]/route.ts` | all (29 lines) | Confirms endpoint is `/api/mcp`; nothing changes here, but the README documents it |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| `McpServer.registerResource` | `@modelcontextprotocol/sdk` v1.26 `dist/esm/server/mcp.d.ts:102-103` | `registerResource(name, ResourceTemplate, config, readCallback)` for dynamic; returns `RegisteredResourceTemplate` |
| `ResourceTemplate` ctor | same, `:222-247` | `new ResourceTemplate('workout://{id}', { list: undefined })` — `list` is **required** in the 2nd arg even when `undefined` |
| Read callback shape | same, `ReadResourceTemplateCallback :324` | `(uri: URL, variables: Variables, extra) => ReadResourceResult`; `Variables = Record<string, string \| string[]>` |
| Resource result shape | `types.d.ts` `TextResourceContentsSchema :1351` | Return `{ contents: [{ uri, mimeType?, text }] }` — note `contents` (resources), NOT `content` (tools) |
| `mcp-handler` callback arg | installed `mcp-handler` v1.1.0 (already in use in `tools.ts`) | The `createMcpHandler` registration callback receives the high-level `McpServer`, so `registerResource` is available alongside `registerTool` |

No further external research needed — the SDK resource API was read directly from the installed package; everything else is established internal pattern.

---

## Patterns to Mirror

### NAMING_CONVENTION
```ts
// SOURCE: src/lib/mcp/read-tools.ts:23, write-tools.ts:74
// Module-per-tool-group; one exported register* function taking the McpServer.
export function registerReadTools(server: McpServer): void { /* ... */ }
// New module follows suit:
export function registerResources(server: McpServer): void { /* ... */ }
```

### ERROR_HANDLING (tools — for contrast)
```ts
// SOURCE: src/lib/mcp/read-tools.ts:54-88
async ({ id, userId }) => {
  try {
    const resolved = resolveUserId(userId)
    const workout = await getWorkoutDetail(resolved, id)
    if (!workout) {
      return errorResult(new ToolError(`Workout ${id} not found for user ${resolved}`))
    }
    // ...build payload...
    return jsonResult({ /* ... */ })
  } catch (error: unknown) {
    return errorResult(error)
  }
}
```
GOTCHA: Resources have no `isError` envelope. The resource read callback must **throw** on error. So mirror the *split* (clean message for expected/not-found; generic for unexpected) but adapt it to throwing — see Task 2.

### LEAK-SAFE SPLIT
```ts
// SOURCE: src/lib/mcp/result.ts:23-29
export function errorResult(error: unknown) {
  if (error instanceof ToolError) {
    return { content: [{ type: 'text' as const, text: error.message }], isError: true as const }
  }
  console.error('MCP tool error:', error)
  return { content: [{ type: 'text' as const, text: 'MCP tool failed' }], isError: true as const }
}
```

### WORKOUT PROJECTION (to extract & reuse)
```ts
// SOURCE: src/lib/mcp/read-tools.ts:64-85 (currently inline in get_workout)
const exercises = workout.exercises.map((exercise) => ({
  id: exercise.id,
  wgerExerciseId: exercise.wgerExerciseId,
  name: exercise.name,
  position: exercise.position,
  sets: exercise.sets.map((s) => ({
    setNumber: s.setNumber,
    reps: s.reps,
    weight: s.weight === null ? null : kgToDisplay(s.weight, unit),
  })),
  estimated1RM: e1rmFor(exercise.sets, unit),
}))
// envelope: { userId, unit, workout: { id, name, startedAt: ISO, exercises } }
```

### TEST_STRUCTURE
```ts
// SOURCE: src/lib/mcp/write-tools.test.ts:4-49
vi.mock('@/db/workouts', () => ({ /* getWorkoutDetail: vi.fn(), ... */ }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))
// fakeServer records registration; tests invoke the captured callback directly.
function payload(result): Record<string, unknown> { return JSON.parse(result.content[0]!.text) }
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/mcp/read-tools.ts` | UPDATE | Extract the inline `get_workout` projection into an exported `buildWorkoutPayload(workout, resolved, unit)`; `get_workout` calls it (no behavior change) |
| `src/lib/mcp/resources.ts` | CREATE | New `registerResources(server)` — the `workout://{id}` resource, reusing `buildWorkoutPayload` |
| `src/lib/mcp/resources.test.ts` | CREATE | Unit tests for the resource: happy path, not-found throws, no-user throws, leak-safe generic on db error |
| `src/lib/mcp/tools.ts` | UPDATE | Call `registerResources(server)` in `registerTools`; update the doc comment (Phase 4) |
| `src/lib/mcp/tools.test.ts` | UPDATE | `fakeServer` gains a `registerResource` recorder; assert the `workout` resource registers |
| `README.md` | UPDATE | Add the "MCP Agent Server" connection section |
| `.claude/PRPs/prds/mcp-agent-server.prd.md` | UPDATE | Flip Phase 4 `pending → in-progress`, link this plan |

## NOT Building
- **Auth / per-user security** on the endpoint or resource — out of scope per the PRD; the resource uses the env-default user.
- **A writable resource** — MCP resources are read semantics; writes stay as tools.
- **A `workout://{userId}/{id}` multi-tenant URI** — single-dev POC; resource user = `MCP_DEV_USER_ID`.
- **A resource `list` callback** (enumerating all workouts as resources) — pass `list: undefined`; listing stays the `list_workouts` tool. (Could-tier; skip.)
- **A separate `.claude` skill doc** — a README section satisfies the success signal; a skill is the rejected alternative.
- **Touching `write-tools.ts`, `result.ts`, `errors.ts`, the route handler, or `src/proxy.ts`** — no changes needed.

---

## Step-by-Step Tasks

### Task 1: Extract `buildWorkoutPayload` in read-tools.ts
- **ACTION**: Refactor the inline projection in `get_workout` (read-tools.ts:64-85) into a single exported function so the resource can reuse the exact same shape.
- **IMPLEMENT**:
  ```ts
  /** Projects a WorkoutDetail into the agent-facing payload: weights in the
   *  user's unit, ISO startedAt, per-exercise estimated 1RM. Shared by the
   *  get_workout tool and the workout://{id} resource. */
  export function buildWorkoutPayload(
    workout: WorkoutDetail,
    resolved: string,
    unit: WeightUnit,
  ) {
    return {
      userId: resolved,
      unit,
      workout: {
        id: workout.id,
        name: workout.name,
        startedAt: workout.startedAt.toISOString(),
        exercises: workout.exercises.map((exercise) => ({
          id: exercise.id,
          wgerExerciseId: exercise.wgerExerciseId,
          name: exercise.name,
          position: exercise.position,
          sets: exercise.sets.map((s) => ({
            setNumber: s.setNumber,
            reps: s.reps,
            weight: s.weight === null ? null : kgToDisplay(s.weight, unit),
          })),
          estimated1RM: e1rmFor(exercise.sets, unit),
        })),
      },
    }
  }
  ```
  Then in `get_workout`, replace the inline build with `return jsonResult(buildWorkoutPayload(workout, resolved, unit))`.
- **MIRROR**: WORKOUT PROJECTION snippet (this is a literal extraction — identical output).
- **IMPORTS**: add `WorkoutDetail` to the existing `import { ... } from '@/db/workouts'`; `WeightUnit` and `kgToDisplay` are already imported.
- **GOTCHA**: `WorkoutDetail` is exported from `src/db/workouts.ts:133` (`NonNullable<Awaited<ReturnType<typeof getWorkoutDetail>>>`). Keep `e1rmFor` private (already in this file) — `buildWorkoutPayload` is its only new caller.
- **VALIDATE**: `npx vitest run src/lib/mcp/read-tools.test.ts` — existing `get_workout` tests must pass unchanged (proves the extraction is behavior-preserving).

### Task 2: Create resources.ts with the `workout://{id}` resource
- **ACTION**: New module exporting `registerResources(server)` that registers one dynamic resource.
- **IMPLEMENT**:
  ```ts
  import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
  import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
  import { resolveUserId } from './resolve-user'
  import { ToolError } from './errors'
  import { buildWorkoutPayload } from './read-tools'
  import { getWorkoutDetail } from '@/db/workouts'
  import { getWeightUnit } from '@/db/preferences'

  /** Registers read-only MCP resources. `workout://{id}` is the addressable
   *  twin of the get_workout tool: same payload, referenced by URI. The user is
   *  the env-default (MCP_DEV_USER_ID) — a resource URI carries no userId arg. */
  export function registerResources(server: McpServer): void {
    server.registerResource(
      'workout',
      new ResourceTemplate('workout://{id}', { list: undefined }),
      {
        title: 'Workout',
        description:
          "A single workout (env-default user) with exercises, sets in the user's unit, and per-exercise estimated 1RM. Same shape as the get_workout tool.",
        mimeType: 'application/json',
      },
      async (uri, variables) => {
        const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
        try {
          const resolved = resolveUserId() // no arg → MCP_DEV_USER_ID
          const workout = await getWorkoutDetail(resolved, id!)
          if (!workout) throw new ToolError(`Workout ${id} not found for user ${resolved}`)
          const unit = await getWeightUnit(resolved)
          const payload = buildWorkoutPayload(workout, resolved, unit)
          return {
            contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload) }],
          }
        } catch (error: unknown) {
          if (error instanceof ToolError) throw error // safe, actionable message
          console.error('MCP resource error:', error)
          throw new Error('MCP resource read failed') // genericize internals
        }
      },
    )
  }
  ```
- **MIRROR**: ERROR_HANDLING + LEAK-SAFE SPLIT (adapted to *throw* — resources can't return `isError`).
- **IMPORTS**: as shown. `ResourceTemplate` is a value import from `@modelcontextprotocol/sdk/server/mcp.js` (same module the SDK types come from).
- **GOTCHA**:
  1. `ResourceTemplate`'s 2nd ctor arg must include `list: undefined` explicitly (SDK requires the key to exist).
  2. Return key is `contents` (array of `{ uri, mimeType, text }`), **not** the tools' `content`.
  3. `variables.id` is `string | string[]` — normalize before use.
  4. No `userId` arg on a resource URI by design — uses `resolveUserId()` (env). If env is unset, `resolveUserId` throws a `ToolError` whose message surfaces to the client. That's intended.
- **VALIDATE**: `npx tsc --noEmit` (types line up with the SDK callback signature).

### Task 3: Write resources.test.ts
- **ACTION**: Mirror `write-tools.test.ts`'s scaffold; a `fakeServer` that records `registerResource(name, template, _config, readCallback)` and exposes the callback.
- **IMPLEMENT** — cover:
  - **happy path**: `getWorkoutDetail` returns a detail, `getWeightUnit` → `'lb'`; invoke the read callback with `new URL('workout://w1')` and `{ id: 'w1' }`; assert `JSON.parse(result.contents[0].text)` equals the `buildWorkoutPayload` shape (userId/unit/workout) and `result.contents[0].uri` is set.
  - **not-found**: `getWorkoutDetail` → `undefined`; expect the callback to **reject** with `/not found/`.
  - **no-user**: `delete process.env.MCP_DEV_USER_ID`; expect rejection `/userId/`; `getWorkoutDetail` not called.
  - **leak-safe**: `getWorkoutDetail` rejects with `new Error('db down: secret-host:5432')`; spy `console.error`; expect rejection with message `'MCP resource read failed'` (no secret) and that `console.error` was called.
  - **registration**: assert a resource named `workout` was registered with a template pattern containing `workout://{id}`.
- **MIRROR**: TEST_STRUCTURE (`vi.mock` db modules, `vi.mocked`, `beforeEach` clear + set `MCP_DEV_USER_ID`, `afterEach` restore).
- **IMPORTS**: `vi.mock('@/db/workouts', () => ({ getWorkoutDetail: vi.fn() }))`, `vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))`; import `registerResources`.
- **GOTCHA**: For rejection assertions use `await expect(readCb(url, vars)).rejects.toThrow(/.../)`. The fake server's `registerResource` signature is `(name, template, config, cb)` — capture `template.uriTemplate?.toString()` for the registration assertion (or store the raw template).
- **VALIDATE**: `npx vitest run src/lib/mcp/resources.test.ts` — all green (RED first: write tests before resources.ts logic is final, confirm they fail, then GREEN).

### Task 4: Wire registerResources into registerTools
- **ACTION**: In `tools.ts`, import and call `registerResources(server)` after the tool registrations; refresh the doc comment to say Phase 4 adds resources.
- **IMPLEMENT**:
  ```ts
  import { registerResources } from './resources'
  // ...inside registerTools, after registerWriteTools(server):
  registerResources(server)
  ```
  Update the JSDoc line about "Phase 4 ergonomics build on top" → note it now registers the `workout://{id}` resource.
- **MIRROR**: the existing `registerReadTools(server)` / `registerWriteTools(server)` calls (tools.ts:47-48).
- **IMPORTS**: `import { registerResources } from './resources'`.
- **GOTCHA**: `registerTools`' own test (`tools.test.ts`) uses a `fakeServer` that only implements `registerTool`; calling `server.registerResource` there will throw `not a function` until Task 5 updates it. Do Task 5 in the same change.
- **VALIDATE**: `npx vitest run src/lib/mcp/tools.test.ts` after Task 5.

### Task 5: Update tools.test.ts fakeServer + add resource assertion
- **ACTION**: Extend the `fakeServer` in `tools.test.ts` to record `registerResource` calls; add a test asserting the `workout` resource registers. The existing tool-set assertion is unchanged (a resource is not a tool).
- **IMPLEMENT**:
  ```ts
  function fakeServer() {
    const tools = new Map<string, ToolHandler>()
    const resources = new Map<string, unknown>() // name -> template
    const server = {
      registerTool: (name: string, _c: unknown, h: ToolHandler) => { tools.set(name, h) },
      registerResource: (name: string, template: unknown) => { resources.set(name, template) },
    }
    return { server: server as unknown as McpServer, tools, resources }
  }
  // new test:
  it('registers the workout resource', () => {
    const { server, resources } = fakeServer()
    registerTools(server)
    expect([...resources.keys()]).toContain('workout')
  })
  ```
- **MIRROR**: existing `fakeServer` (tools.test.ts:13-21).
- **IMPORTS**: none new.
- **GOTCHA**: keep the existing 11-tool `toEqual([...])` assertion exactly as is — adding a resource must not change it.
- **VALIDATE**: `npx vitest run src/lib/mcp/tools.test.ts` green.

### Task 5b: read-tools.test.ts / write-tools.test.ts fakeServers
- **ACTION**: None expected. Those tests call `registerReadTools` / `registerWriteTools` directly (not `registerTools`), so their fake servers never receive `registerResource`. Confirm by scanning: only `tools.ts` calls `registerResources`.
- **VALIDATE**: `npx vitest run src/lib/mcp` all green.

### Task 6: README "MCP Agent Server" section
- **ACTION**: Add a section to `README.md` documenting the endpoint so a fresh agent/client can connect and run read→create→read. Keep the existing Next.js boilerplate below it.
- **IMPLEMENT** — cover, concisely:
  - **Endpoint**: `https://<your-deployment>/api/mcp` (and `http://localhost:3000/api/mcp` for `npm run dev`). Streamable HTTP transport.
  - **⚠️ No auth (POC)**: public and unauthenticated by design; not production-safe (link the PRD's "What We're NOT Building").
  - **Target user**: set `MCP_DEV_USER_ID` in the env so tools/resources resolve a user without an arg; or pass `userId` to any tool.
  - **Connecting Claude**: add as a remote MCP server by URL (one or two lines + where in the client UI).
  - **Surface**: a compact table of tools (`ping`, `whoami`, `list_workouts`, `get_workout`, `search_exercises`, `get_last_performance`, `get_weight_unit`, `create_workout`, `update_workout`, `delete_workout`, `set_weight_unit`) with a one-line purpose each, plus the `workout://{id}` resource.
  - **Worked example** (the success-signal loop): `whoami` → `search_exercises({search:'bench'})` → `create_workout({exercises:[...]})` → `get_workout({id})` (note weights are in the user's unit; `unit` is echoed).
- **MIRROR**: existing README heading style (`##` sections).
- **IMPORTS**: n/a.
- **GOTCHA**: Don't document a `userId` arg on the resource (it has none); state the resource uses the env user. Keep weights-in-display-unit and the kg storage note accurate.
- **VALIDATE**: Manual read-through against the success signal: "could a fresh agent connect and complete read→create→read from this section alone?"

### Task 7: Update the PRD phase status
- **ACTION**: In `mcp-agent-server.prd.md`, set Phase 4 `pending → in-progress` in the phases table (line 113) and add this plan path in the PRP Plan cell.
- **IMPLEMENT**: `| 4 | Ergonomics + connection doc | ... | in-progress | - | 2, 3 | [plan](../plans/mcp-ergonomics-and-connection-doc.plan.md) |`
- **MIRROR**: how Phases 1–3 link `[plan](...)` (and add `[report]` later at implement time).
- **VALIDATE**: visual diff; no other PRD lines change.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| resource happy path | `getWorkoutDetail`→detail, unit `lb`, read `workout://w1` | `contents[0].text` = `buildWorkoutPayload` JSON; `contents[0].uri` set | No |
| resource weights in unit | a kg set weight, unit `lb` | set weight rendered via `kgToDisplay` (matches get_workout) | Yes (unit conversion) |
| resource not found | `getWorkoutDetail`→`undefined` | callback rejects `/not found/` | Yes |
| resource no user | no arg, no `MCP_DEV_USER_ID` | rejects `/userId/`; `getWorkoutDetail` not called | Yes |
| resource db error leak-safe | `getWorkoutDetail` rejects with secret-bearing error | rejects `'MCP resource read failed'`; `console.error` called; no secret in message | Yes |
| resource registered | `registerTools(fakeServer)` | `resources` map contains `workout` | No |
| get_workout unchanged | existing read-tools.test cases | all pass post-extraction | regression |
| tool set unchanged | `registerTools` | same 11-tool sorted array | regression |

### Edge Cases Checklist
- [x] Missing/empty id → `getWorkoutDetail` returns undefined → not-found throw
- [x] `id` arrives as `string[]` → normalized to first element
- [x] No resolvable user → throws `/userId/`
- [x] DB failure → generic message, internals logged not leaked
- [x] Unit conversion parity with `get_workout` (shared `buildWorkoutPayload`)
- [ ] Concurrent access — n/a (read-only, stateless handler)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors.

### Lint (scoped — avoids the worktree `.next` noise)
```bash
npx eslint src/lib/mcp README.md
```
EXPECT: Clean (exit 0).

### Unit Tests (MCP)
```bash
npx vitest run src/lib/mcp
```
EXPECT: All pass, including the new `resources.test.ts` and the unchanged read/tools regressions.

### Full Test Suite (scoped to project src to skip worktree pollution)
```bash
npx vitest run src
```
EXPECT: No regressions in project tests. (A bare `npx vitest run` also reports failures from `.claude/worktrees/**`; those are out of scope — known tooling noise.)

### Manual / Connection Validation
- [ ] `npm run dev`, set `MCP_DEV_USER_ID` to a real seeded user, connect an MCP client to `http://localhost:3000/api/mcp`.
- [ ] List tools + resources; confirm `workout` resource appears.
- [ ] Read `workout://<an-existing-id>`; confirm payload matches `get_workout({id})`.
- [ ] Run the README worked example end-to-end: `whoami` → `search_exercises` → `create_workout` → `get_workout`.

---

## Acceptance Criteria
- [ ] `workout://{id}` resource registered and returns the `get_workout` payload for the env-default user
- [ ] Resource not-found and db-error paths throw (leak-safe), no-user throws `/userId/`
- [ ] `buildWorkoutPayload` extracted; `get_workout` behavior unchanged (existing tests pass)
- [ ] README "MCP Agent Server" section lets a fresh agent connect + run read→create→read
- [ ] PRD Phase 4 marked `in-progress` with plan link
- [ ] `tsc` clean, `eslint src/lib/mcp README.md` clean, `vitest run src` green

## Completion Checklist
- [ ] New module mirrors `register*` convention and file layout
- [ ] Error handling mirrors the `ToolError`/genericize split (adapted to throwing)
- [ ] `console.error` used for unexpected errors (matches `result.ts`)
- [ ] Tests mirror `write-tools.test.ts` scaffold and AAA naming
- [ ] No hardcoded values; `resolveUserId` for the user
- [ ] README accurate (no auth, env user, weights in display unit, kg storage)
- [ ] No scope additions (no write resource, no `list`, no auth)
- [ ] Self-contained — implementable from this plan without further searching

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `ResourceTemplate` ctor rejects missing `list` key | M | Build error | Pass `{ list: undefined }` explicitly (documented SDK requirement) |
| Confusing `contents` (resource) vs `content` (tool) result key | M | Runtime/protocol error | Called out in Task 2 GOTCHA + asserted in tests (`result.contents[0].text`) |
| Extraction subtly changes `get_workout` output | L | Regression | Pure literal extraction; existing `read-tools.test.ts` get_workout tests are the guard |
| `registerResource` breaks `tools.test.ts` fakeServer | M | Test failure | Task 5 updates the fake server in the same change |
| Resource leaks DB internals on error | L | Info disclosure | Genericize non-`ToolError` throws (`'MCP resource read failed'`), log server-side |

## Notes
- **Phase 4 items already done** (verified in code, no work needed): structured tool errors (`errors.ts`/`result.ts`), resolved-user echo (every tool returns `userId`), `userId` arg/env resolution (`resolve-user.ts`). This plan covers only the genuinely-new resource + doc.
- **Doc choice**: README section over a `.claude` skill — simpler, discoverable, satisfies the success signal. Skill is the rejected alternative.
- **Endpoint reality check**: route lives at `src/app/api/[transport]/route.ts` with `basePath: '/api'`, so the URL is `/api/mcp` (the `[transport]` segment = `mcp`). No route changes in this phase.
- **SDK**: `@modelcontextprotocol/sdk@^1.26.0`, `mcp-handler@^1.1.0`, `zod@^4.4.3`, Next 16.2.9 — all already installed; no new dependencies.
