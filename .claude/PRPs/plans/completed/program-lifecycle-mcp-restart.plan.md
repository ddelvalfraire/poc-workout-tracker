# Plan: Program Lifecycle — MCP `restart_program` (Phase 4)

## Summary
Give Claude the same one-tap block rollover the UI got in Phase 3: a `restart_program` MCP tool that composes the exact two db calls `restartProgramAction` makes — `cloneProgram` (row-faithful copy, "Name — Block k", draft) then `setProgramStatus(clone, 'active')` (single-active sweep archives an active source). Registered and tested per the established program-tools conventions; both registry count tests grow by one.

## User Story
As a lifter managing my training through Claude, I want to say "roll my block over" and have the MCP tool return the new programId, so the next mesocycle starts without opening the app.

## Problem → Solution
Restart exists only behind the UI's confirm dialog → register `restart_program` beside `set_program_status`, wrapping the identical clone+activate path, so the MCP surface reaches parity with the app (every other lifecycle op is already a tool).

## Metadata
- **Complexity**: Small
- **Source PRD**: `.claude/PRPs/prds/program-lifecycle.prd.md`
- **PRD Phase**: Phase 4 — MCP `restart_program`
- **Estimated Files**: 4

---

## UX Design
N/A — internal/MCP change. Tool-call surface only:

```
restart_program { id: "<program-uuid>" }
→ { userId, programId: "<new>", sourceProgramId: "<id>", status: "active" }
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| MCP tool set | 36 tools, restart UI-only | 37 tools incl. `restart_program` | Fidelity guaranteed by `cloneProgram` (Phase 3) |

---

## DESIGN DECISION — compose in the handler, no db-layer `restartProgram` extraction

`restartProgramAction` (src/app/programs/actions.ts) composes `cloneProgram` → `setProgramStatus` in 4 lines. The tool duplicates those 4 lines rather than extracting a shared db function, because: (a) the two layers' error semantics differ (`ToolError` → `errorResult` vs thrown `Error` for the client try/catch); (b) same-module composition is awkward to unit-test at the db layer (can't mock sibling exports), while the MCP harness already module-mocks `@/db/programs` — parity is asserted directly (clone called with (user, id); setProgramStatus with (user, cloneId, 'active')); (c) the PRD's "same fidelity guarantees" hold by construction since BOTH paths call the same `cloneProgram`.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/mcp/program-tools.ts` | 1-31 (imports), 352-495 | Registration conventions; `set_program_status` (476-495) is the template: resolveUserId → assertProgramIdShape → db call → ToolError on null → jsonResult |
| P0 | `src/lib/mcp/program-tools.test.ts` | 1-70 (harness), 173-186 (count test), 523-549 (set_program_status tests), 702-728 (no-user gate table) | The fake-server harness, mocked `@/db/programs` module, and the three test shapes every tool gets |
| P0 | `src/app/programs/actions.ts` | restartProgramAction | The 4-line composition to mirror EXACTLY (clone → activate → both null-checked) |
| P1 | `src/lib/mcp/tools.test.ts` | 42-87 | Full-registry sorted list — gains `restart_program` |
| P1 | `src/db/programs.ts` | cloneProgram JSDoc | What the tool description should promise (row fidelity, draft, naming) |
| P2 | `src/lib/mcp/result.ts`, `src/lib/mcp/errors.ts` | all | `jsonResult`/`errorResult`/`ToolError` used verbatim |

## External Documentation
None — established internal patterns only.

---

## Patterns to Mirror

### TOOL_REGISTRATION (set_program_status — the template)
```ts
// SOURCE: src/lib/mcp/program-tools.ts:476-495
server.registerTool(
  'set_program_status',
  {
    title: 'Set Program Status',
    description:
      "Sets a program's lifecycle status ('draft', 'active', or 'archived') without touching its days/exercises/sets. Activating a program archives any other active program (one active at a time). Errors if not found or not owned.",
    inputSchema: { id: z.string(), status: statusSchema, userId: z.string().optional() },
  },
  async ({ id, status, userId }, extra) => {
    try {
      const resolved = resolveUserId(extra, userId)
      assertProgramIdShape(id)
      const result = await setProgramStatus(resolved, id, status)
      if (!result) throw new ToolError(`Program ${id} not found for user ${resolved}`)
      return jsonResult({ userId: resolved, programId: result.id, status })
    } catch (error: unknown) {
      return errorResult(error)
    }
  },
)
```

### ACTION_COMPOSITION (the path to wrap, byte-for-byte semantics)
```ts
// SOURCE: src/app/programs/actions.ts (restartProgramAction)
const clone = await cloneProgram(userId, id)
if (!clone) throw new Error('program not found')
const activated = await setProgramStatus(userId, clone.id, 'active')
if (!activated) throw new Error('could not activate the new block')
```

### TOOL_TEST_SHAPE (success + not-owned pair)
```ts
// SOURCE: src/lib/mcp/program-tools.test.ts:523-548
describe('set_program_status', () => {
  it('sets the status and echoes it', async () => {
    const tools = setup()
    mockedSetStatus.mockResolvedValue({ id: PID })
    const result = await tools.get('set_program_status')!({ id: PID, status: 'active' })
    expect(mockedSetStatus).toHaveBeenCalledWith('user_env', PID, 'active')
    expect(payload(result)).toEqual({ userId: 'user_env', programId: PID, status: 'active' })
  })
  it('returns isError /not found/ when the program is not owned', async () => {
    const tools = setup()
    mockedSetStatus.mockResolvedValue(null)
    const result = await tools.get('set_program_status')!({ id: PID, status: 'archived' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not found/)
  })
})
```

### MALFORMED_ID_TEST (fail fast, db untouched)
```ts
// SOURCE: src/lib/mcp/program-tools.test.ts:688-699
it('surfaces not-found for a malformed id without hitting the db', async () => {
  const tools = setup()
  const result = await tools.get('instantiate_program_day')!({ programDayId: 'not-a-uuid' })
  expect(result.isError).toBe(true)
  expect(result.content[0]?.text).toMatch(/not found/)
  expect(mockedInstantiate).not.toHaveBeenCalled()
})
```

### NO_USER_GATE_TABLE (every program tool joins it)
```ts
// SOURCE: src/lib/mcp/program-tools.test.ts:704-710
const cases = [
  { name: 'get_program', args: { id: PID }, dep: mockedDetail as unknown as Mock },
  ...
  { name: 'set_program_status', args: { id: PID, status: 'active' }, dep: mockedSetStatus as unknown as Mock },
] as const
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/mcp/program-tools.test.ts` | UPDATE | TDD: mock `cloneProgram`, `restart_program` describe (4 cases), count 7→8, no-user gate row |
| `src/lib/mcp/program-tools.ts` | UPDATE | Register `restart_program`; import `cloneProgram` |
| `src/lib/mcp/tools.test.ts` | UPDATE | Add `restart_program` to the sorted full-registry list |
| `.claude/PRPs/prds/program-lifecycle.prd.md` | UPDATE | Phase 4 status at report time |

## NOT Building

- A shared db-layer `restartProgram` extraction (see DESIGN DECISION)
- Unit-arg / weight conversion — the tool moves no loads (ids and status only)
- A `name` override argument — naming stays `nextBlockName`-automatic, same as the UI (rename via `upsert_program`/builder after)
- Changes to `restartProgramAction`, `cloneProgram`, or `setProgramStatus` — Phase 3 code is untouched
- README/docs updates — no doc file lists the MCP tools (verified by grep)

---

## Step-by-Step Tasks

### Task 1: Failing tool tests (RED)
- **ACTION**: Update `src/lib/mcp/program-tools.test.ts`.
- **IMPLEMENT**:
  1. Add `cloneProgram: vi.fn()` to the `vi.mock('@/db/programs', ...)` factory, import it alongside the others, and add `const mockedClone = vi.mocked(cloneProgram)`.
  2. Count test: `'registers exactly the eight program tools'` — insert `'restart_program'` into the sorted expected array (between `'preview_program_week'` and `'set_program_status'`; keep the array sorted).
  3. New `describe('restart_program')` after the `set_program_status` block:
     - **clones then activates, echoing the new id**: `mockedClone.mockResolvedValue({ id: 'p-clone' })`, `mockedSetStatus.mockResolvedValue({ id: 'p-clone' })`; call `tools.get('restart_program')!({ id: PID })`; assert `mockedClone` called with `('user_env', PID)`, `mockedSetStatus` with `('user_env', 'p-clone', 'active')`, and `payload(result)` equals `{ userId: 'user_env', programId: 'p-clone', sourceProgramId: PID, status: 'active' }`.
     - **isError /not found/ when the source is not owned**: `mockedClone.mockResolvedValue(null)` → `isError`, text matches `/not found/`, and `mockedSetStatus` NOT called (no activation of anything on a failed clone).
     - **isError when activation fails after the clone**: clone resolves `{ id: 'p-clone' }`, `mockedSetStatus.mockResolvedValue(null)` → `isError`, text matches `/activate/`.
     - **malformed id fails fast**: `{ id: 'not-a-uuid' }` → `isError` `/not found/`, `mockedClone` not called (MALFORMED_ID_TEST shape).
  4. No-user gate table: add `{ name: 'restart_program', args: { id: PID }, dep: mockedClone as unknown as Mock }`.
- **MIRROR**: TOOL_TEST_SHAPE, MALFORMED_ID_TEST, NO_USER_GATE_TABLE.
- **GOTCHA**: `payload()` parses `content[0].text` — assert with `toEqual` on the full object (echo contract, like set_program_status's test).
- **VALIDATE**: `npm test -- src/lib/mcp/program-tools.test.ts` → RED (unknown tool + count mismatch).

### Task 2: Register `restart_program` (GREEN)
- **ACTION**: Update `src/lib/mcp/program-tools.ts`.
- **IMPLEMENT**: Add `cloneProgram` to the `@/db/programs` import list. Register after `set_program_status` (before `instantiate_program_day`):
  ```ts
  server.registerTool(
    'restart_program',
    {
      title: 'Restart Program',
      description:
        "Rolls a block over: clones the program row-for-row (days, exercises incl. supersets/custom exercises/progression, sets, per-week overrides, muscle tags) as 'Name — Block k' and activates the clone — archiving any other active program (one active at a time; an already-archived source just stays archived). The clone starts fresh at week 1; the source keeps its history and stats. Returns the new programId. Errors if the program isn't found or owned.",
      inputSchema: { id: z.string(), userId: z.string().optional() },
    },
    async ({ id, userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        assertProgramIdShape(id)
        // Same two-step path as the UI's restartProgramAction: the clone
        // commits before activation, so a failed activate leaves only a
        // harmless draft copy (retry-safe).
        const clone = await cloneProgram(resolved, id)
        if (!clone) throw new ToolError(`Program ${id} not found for user ${resolved}`)
        const activated = await setProgramStatus(resolved, clone.id, 'active')
        if (!activated) {
          throw new ToolError(`Could not activate program ${clone.id} for user ${resolved}`)
        }
        return jsonResult({
          userId: resolved,
          programId: clone.id,
          sourceProgramId: id,
          status: 'active',
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
  ```
- **MIRROR**: TOOL_REGISTRATION; ACTION_COMPOSITION for the two-step semantics.
- **IMPORTS**: `cloneProgram` joins the existing `@/db/programs` import.
- **GOTCHA**: `assertProgramIdShape` BEFORE the db call (fail-fast contract the malformed-id test enforces). Keep the payload field names/order exactly as tested.
- **VALIDATE**: Task 1 green; `npx tsc --noEmit`.

### Task 3: Full-registry list
- **ACTION**: Update `src/lib/mcp/tools.test.ts`.
- **IMPLEMENT**: Add `'restart_program'` to the sorted expected array in `'registers the connectivity, read, write, patch, and program tools'` (between `'remove_set'` and `'search_exercises'`).
- **VALIDATE**: `npm test -- src/lib/mcp/tools.test.ts` green.

### Task 4: Full validation
- **VALIDATE**: commands below; diff touches only the listed files.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| clone→activate order + echo | valid id, both succeed | payload with new programId, sourceProgramId, status active | |
| source not owned | clone → null | isError /not found/, activate never called | ✓ |
| activate fails post-clone | status → null | isError /activate/ | ✓ |
| malformed id | 'not-a-uuid' | isError /not found/, clone never called | ✓ |
| no-user gate | env cleared | isError /userId/, db untouched | ✓ |
| program-tools count | — | exactly 8 tools | regression |
| full registry | — | sorted list incl. restart_program | regression |

### Edge Cases Checklist
- [x] Not owned / missing program
- [x] Activation failure after commit (draft clone remains — documented, matches UI)
- [x] Malformed id fails before any db call
- [x] No resolvable user
- [ ] Concurrent restarts — POC-accepted (same as UI path)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npx eslint src/lib/mcp/program-tools.ts src/lib/mcp/program-tools.test.ts src/lib/mcp/tools.test.ts
```
EXPECT: zero errors

### Unit Tests
```bash
npm test -- src/lib/mcp/program-tools.test.ts src/lib/mcp/tools.test.ts
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: 955 existing + new, no regressions

### Build
```bash
npm run build
```
EXPECT: clean

### Manual Validation
- [ ] Via the connected workout-tracker MCP: `restart_program` on a program returns the new id; `list_programs` shows "— Block k" active and the source archived; `get_program` on the clone shows supersets/overrides intact

---

## Acceptance Criteria
- [ ] All tasks complete, TDD order respected
- [ ] Tool composes the SAME `cloneProgram` + `setProgramStatus` path as the UI action
- [ ] Registry counts updated (program-tools 8, full list +1)
- [ ] Fail-fast id shape check; no-user gate; not-owned and activate-failure errors

## Completion Checklist
- [ ] Tool description states naming, archiving, week-1 semantics honestly
- [ ] Payload echoes resolved userId (module convention)
- [ ] No unit conversion added (no loads move)
- [ ] Self-contained — no codebase searching during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Registry list drift (three places name the tool) | L | Test failures (loud) | Count tests are exactly the net that catches it |
| Tool/UI paths diverge later | L | Parity loss | Both call the same two db functions; clone fidelity tests live at the db layer |

## Notes
- This is the PRD's final phase — at report time mark Phase 4 complete and the PRD itself done.
- The live MCP session may need a reconnect after deploy for the new tool to appear in Claude's tool list.
