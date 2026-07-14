# Plan: Program Lifecycle — Single-Active + Leave UX (Phase 1)

## Summary
Make "active program" an invariant instead of a recency tiebreak — activating a program archives any other active one (in `setProgramStatus`, so web and MCP both inherit it) — and turn the bare "Archive" button into a "Leave program" confirm with honest copy (history stays; mid-week context). No schema changes.

## User Story
As a lifter switching or stopping programs, I want activating a new program to cleanly retire the old one, and leaving a program to tell me what happens to my history, so the home screen always reflects the one program I'm actually running.

## Problem → Solution
Two programs can both be `active` (hero silently follows `updatedAt` recency) and "Archive" is a bare, unexplained tap → `setProgramStatus(…, 'active')` archives sibling actives after the ownership-gated activate; the archive action becomes a ConfirmDialog "Leave program" flow with week context.

## Metadata
- **Complexity**: Small
- **Source PRD**: `.claude/PRPs/prds/program-lifecycle.prd.md`
- **PRD Phase**: Phase 1 — Single-active + Leave UX
- **Estimated Files**: 5 (1 new test file, 4 edits)

---

## UX Design

### Before
```
Program page actions: [Edit] [Archive]  [Delete]
"Archive" applies instantly, no confirm, no explanation.
Activating program B while A is active → both active; hero picks by updatedAt.
```

### After
```
Active program:   [Edit] [Leave program] [Delete]
                              │ tap
                  ┌────────────────────────────────┐
                  │ Leave this program?            │
                  │ Your workouts and stats stay.  │
                  │ You're in week 2 of 7 — you    │
                  │ can reactivate it any time.    │
                  │ [Keep it]   [Leave program]    │
                  └────────────────────────────────┘
Draft/archived:   [Edit] [Activate] [Delete]   (unchanged, still direct)
Activate now archives any other active program — exactly one active, always.
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Program page status toggle (active) | "Archive", instant | "Leave program" → ConfirmDialog | Reuses the app's one dialog vocabulary |
| Program page status toggle (non-active) | "Activate", instant | unchanged | Activation is the safe direction |
| `setProgramStatus(…, 'active')` (web + MCP) | Sets one row | Also archives sibling actives | Single-active invariant lives in the db layer |
| Home hero | Recency tiebreak between actives | At most one active exists | No hero code change needed |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/programs.ts` | 240–256 | `setProgramStatus` — the function being extended; ownership-gated `update … returning` |
| P0 | `src/app/programs/[id]/program-actions.tsx` | all | The island being edited: status toggle + existing delete ConfirmDialog wiring (closeRef, pending, error split) |
| P0 | `src/components/confirm-dialog.tsx` | 28–42, 130–152 | Dialog contract: stays open while pending, `closeRef` before nav, "Keep it" cancel, destructive confirm |
| P1 | `src/db/patch-sets.test.ts` | 1–55 | Chain-recording update-mock harness to mirror (getTableName op tagging, whereArgs capture) |
| P1 | `src/db/program-stats.test.ts` | 307–321 | PgDialect `sqlToQuery(...).params` where-introspection idiom |
| P2 | `src/app/programs/[id]/page.tsx` | 37–47, 424 | `currentWeek` already computed; `<ProgramActions id status />` call site gains week props |
| P2 | `src/lib/mcp/program-tools.ts` | 477–495 | `set_program_status` description to update (one sentence) |

## External Documentation
None needed — established internal patterns only.

---

## Patterns to Mirror

### OWNERSHIP_GATED_UPDATE (the function being extended)
```ts
// SOURCE: src/db/programs.ts:244-256
export async function setProgramStatus(
  userId: string, id: string, status: ProgramInput['status'],
): Promise<{ id: string } | null> {
  const [owned] = await db
    .update(programs)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(programs.id, id), eq(programs.userId, userId)))
    .returning({ id: programs.id })
  return owned ?? null
}
```

### CONFIRM_DIALOG_WIRING (delete flow in the same file — copy its shape)
```tsx
// SOURCE: src/app/programs/[id]/program-actions.tsx:60-76 (handleDelete)
async function handleDelete() {
  setIsPending(true)
  try {
    setDeleteError(null)
    await deleteProgramAction(id)
    closeDialogRef.current?.()   // release top layer BEFORE navigating
    setIsModalOpen(false)
    router.push('/programs')
  } catch {
    setIsPending(false)
    setDeleteError('Could not delete program. Please try again.')  // renders IN dialog
  }
}
```
Leave differs in the success tail: no navigation — `closeDialogRef.current?.()`, close state, `router.refresh()`, and `setIsPending(false)` (the island stays mounted).

### UPDATE_MOCK_HARNESS (db test)
```ts
// SOURCE: src/db/patch-sets.test.ts:31-48
function updateChain(table: unknown) {
  const name = getTableName(table as Table)
  const obj = {
    set: (values: unknown) => { records.push({ op: `update:${name}`, values }); return obj },
    where: () => obj,   // → extend: capture the condition into whereArgs
    returning: () => ({ then: (resolve) => Promise.resolve(rows).then(resolve) }),
    then: (resolve) => Promise.resolve(undefined).then(resolve),  // await .where() directly
  }
  return obj
}
```

### WHERE_INTROSPECTION (assert scoping without a db)
```ts
// SOURCE: src/db/program-stats.test.ts:312-315
const gate = new PgDialect().sqlToQuery(whereArgs[0] as SQL)
expect(gate.params).toContain(USER)
expect(gate.params).toContain('p1')
```

### DIALOG_ERROR_SPLIT (two error surfaces on purpose)
```tsx
// SOURCE: src/app/programs/[id]/program-actions.tsx:28-32
// a status-toggle failure renders on the page (its control lives there), a
// delete failure renders INSIDE the dialog (the user retries in place)
```
The leave flow's error belongs INSIDE its dialog (retry in place) — separate `leaveError` state, same rationale.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/program-status.test.ts` | CREATE | TDD the single-active invariant (no db-level test exists for `setProgramStatus`) |
| `src/db/programs.ts` | UPDATE | `setProgramStatus`: archive sibling actives after a successful activate |
| `src/app/programs/[id]/program-actions.tsx` | UPDATE | "Leave program" ConfirmDialog for the active→archived path |
| `src/app/programs/[id]/page.tsx` | UPDATE | Pass `currentWeek` + `mesocycleWeeks` to `ProgramActions` for the dialog copy |
| `src/lib/mcp/program-tools.ts` | UPDATE | `set_program_status` description: one sentence noting activate archives other actives |
| `.claude/PRPs/prds/program-lifecycle.prd.md` | UPDATE | Phase 1 status |

## NOT Building

- Block-completion state, completion card, restart — Phases 2–3
- Any change to `ConfirmDialog` itself (its destructive-styled confirm is accepted for v1; the body copy carries the "nothing is lost" reassurance — revisit only if review flags it)
- Status vocabulary changes elsewhere (pill still reads "archived"; the programs list is untouched)
- Draft-handling changes (draft → active stays a plain "Activate")
- A db transaction around the two updates (single-user POC; activate-first ordering makes the failure mode benign — see GOTCHA)

---

## Step-by-Step Tasks

### Task 1: Failing db tests (RED)
- **ACTION**: Create `src/db/program-status.test.ts` before touching the module.
- **IMPLEMENT**: Chain-recording harness per UPDATE_MOCK_HARNESS with `whereArgs` capture on `.where(cond)`; mock `./index`'s `db.update`. Outcome toggles: `ownedRows` (the gated activate's `.returning()`), plus a plain thenable for the sibling-archive update (no `.returning()`). Cases:
  1. `setProgramStatus(USER, 'p1', 'active')` on an owned program → TWO updates recorded in order (gated activate first, then sibling archive); sibling archive's `set` values include `status: 'archived'`; its where-params (WHERE_INTROSPECTION) contain `USER`, `'p1'` (the `ne(id)` exclusion), and `'active'` (only actives demote).
  2. Not-owned activate (`ownedRows = []`) → returns null and only ONE update recorded (no sibling archive after a failed gate).
  3. `'archived'` and `'draft'` statuses → exactly ONE update each (sibling sweep only on activate).
  4. Success returns `{ id: 'p1' }` (shape unchanged for existing callers).
- **MIRROR**: UPDATE_MOCK_HARNESS + WHERE_INTROSPECTION; AAA, descriptive names.
- **IMPORTS**: `import { setProgramStatus } from './programs'`; `PgDialect` from `drizzle-orm/pg-core`; `getTableName, type Table, type SQL` from `drizzle-orm`.
- **GOTCHA**: `vi.mock('./index')` must expose `db.update` only — `setProgramStatus` touches nothing else. The sibling-archive update is awaited via the builder's thenable (`.where()` tail), mirroring patch-sets' renumber path.
- **VALIDATE**: `npm test -- src/db/program-status.test.ts` → RED (single update recorded today).

### Task 2: Single-active in `setProgramStatus` (GREEN)
- **ACTION**: Extend `setProgramStatus` in `src/db/programs.ts`.
- **IMPLEMENT**: Keep the ownership-gated update exactly as is. After it, when `status === 'active'` AND the gate returned a row, run the sibling sweep:
  ```ts
  if (status === 'active' && owned) {
    // Single-active invariant: the home hero must never tiebreak between
    // two actives by recency. Swept AFTER the ownership-gated activate so
    // an unowned id can't archive anyone's programs.
    await db
      .update(programs)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(programs.userId, userId), eq(programs.status, 'active'), ne(programs.id, id)))
  }
  ```
  Add `ne` to the existing `drizzle-orm` import. Update the function's JSDoc (activate archives sibling actives).
- **MIRROR**: OWNERSHIP_GATED_UPDATE.
- **GOTCHA**: Order is a security property — gate FIRST, sweep second (a not-owned activate must not archive anything). No transaction: if the sweep fails after a successful activate, the pre-existing two-active state persists (exactly today's behavior) — benign, self-heals on the next activate.
- **VALIDATE**: Task 1 tests green; `npx tsc --noEmit`.

### Task 3: "Leave program" dialog in ProgramActions
- **ACTION**: Edit `src/app/programs/[id]/program-actions.tsx` and its call site in `page.tsx`.
- **IMPLEMENT**:
  - Props: add `currentWeek: number` and `mesocycleWeeks: number`; `page.tsx:424` passes `currentWeek={currentWeek} mesocycleWeeks={program.mesocycleWeeks}` (both already in scope on the page).
  - Label: `status === 'active' ? 'Leave program' : 'Activate'` (replaces `statusLabel`).
  - Behavior: Activate keeps the direct `handleStatusToggle` path. Leave opens a NEW dialog state (`isLeaveModalOpen`, `leaveError`, its own `closeLeaveDialogRef`) — do not reuse the delete dialog's state (DIALOG_ERROR_SPLIT rationale).
  - `handleLeave` mirrors CONFIRM_DIALOG_WIRING with a refresh tail:
    ```ts
    await setProgramStatusAction(id, 'archived')
    closeLeaveDialogRef.current?.()
    setIsLeaveModalOpen(false)
    router.refresh()
    setIsPending(false)   // island stays mounted — always re-enable
    ```
    catch → `setIsPending(false)`, `setLeaveError('Could not leave this program. Please try again.')`.
  - Dialog copy (ConfirmDialog props): title `Leave this program?`; body `` `Your workouts and stats are kept. You're in week ${currentWeek} of ${mesocycleWeeks} — you can reactivate it any time from Programs.` ``; confirmLabel `Leave program`; pendingLabel `Leaving…`; error `leaveError`.
- **MIRROR**: CONFIRM_DIALOG_WIRING; the existing delete dialog in the same file is the exact template.
- **IMPORTS**: none new (`ConfirmDialog`, `setProgramStatusAction`, `useRef` already imported).
- **GOTCHA**: The dialog stays open while pending (contract); Esc/backdrop dismiss are already pending-guarded by ConfirmDialog. Keep the existing page-level `statusError` for the Activate path only.
- **VALIDATE**: `npx tsc --noEmit`; `npm run build`.

### Task 4: MCP description honesty
- **ACTION**: Update `set_program_status`'s description in `src/lib/mcp/program-tools.ts` (~line 481).
- **IMPLEMENT**: Append: `Activating a program archives any other active program (one active at a time).` No schema/handler change — the behavior arrives via `setProgramStatus`.
- **GOTCHA**: `program-tools.test.ts` mocks `setProgramStatus`, so no MCP test changes; the invariant is covered at the db layer (Task 1).
- **VALIDATE**: `npm test -- src/lib/mcp/program-tools.test.ts` still green.

### Task 5: Full validation
- **VALIDATE**: commands below; `git diff --stat` shows only the listed files.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| activate sweeps siblings | owned p1 → active | 2 updates; sweep sets archived, scoped userId + ne(p1) + status=active | |
| not-owned activate | gate returns [] | null; exactly 1 update (no sweep) | ✓ security |
| archive is single-update | owned p1 → archived | 1 update, no sweep | ✓ |
| draft is single-update | owned p1 → draft | 1 update, no sweep | ✓ |
| return shape | owned success | `{ id: 'p1' }` | regression |

UI: no component test (repo convention — client islands validated by build + manual pass; the db invariant carries the logic).

### Edge Cases Checklist
- [x] Not-owned target must not trigger the sweep
- [x] Non-active statuses never sweep
- [x] Sweep excludes the just-activated id (`ne`)
- [ ] Concurrent activates — N/A single-user POC (documented no-transaction decision)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npx eslint src/db/programs.ts src/db/program-status.test.ts "src/app/programs/[id]/program-actions.tsx" "src/app/programs/[id]/page.tsx" src/lib/mcp/program-tools.ts
```
EXPECT: zero errors

### Unit Tests
```bash
npm test -- src/db/program-status.test.ts
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: 913 existing + new, no regressions

### Build
```bash
npm run build
```
EXPECT: clean

### Manual Validation
- [ ] Active program → "Leave program" → dialog shows week context → confirm → page shows archived status, home hero stops suggesting it
- [ ] Activate a second program while one is active → the first flips to archived (check /programs list)
- [ ] "Keep it" and backdrop tap dismiss without changes; error path renders inside the dialog

---

## Acceptance Criteria
- [ ] All tasks complete, TDD order respected
- [ ] All validation commands pass
- [ ] Exactly one active program after any activate (db-level tests prove scoping)
- [ ] Leave flow confirms with week context and keeps history untouched
- [ ] Activate path unchanged (direct, no dialog)

## Completion Checklist
- [ ] Sweep ordered after the ownership gate (security property, tested)
- [ ] Dialog follows the closeRef/pending/error contract
- [ ] No ConfirmDialog component changes
- [ ] MCP description matches new behavior
- [ ] Self-contained — no codebase searching during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sweep archives programs on a not-owned activate | L (designed out) | High if wrong | Gate-first ordering + explicit RED test for it |
| Destructive-styled confirm reads as data loss | M | Trust | Body copy leads with "kept"; revisit variant at review if it still reads wrong |
| Users relying on two actives (none known) | L | Behavior change | Single-user app; PRD decision |

## Notes
- Phase 2 (completion card) will reuse this dialog vocabulary for Restart's confirm; keeping leave-state separate from delete-state in the island sets that precedent.
- The MCP path inherits the invariant with zero handler changes — the reason the sweep lives in `setProgramStatus`, not the web action.
