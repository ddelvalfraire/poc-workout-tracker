# Plan: Edit & Delete (Phase 5)

## Summary
Let a signed-in user correct or remove a saved workout. The read-only detail page (`/workout/[id]`) gains an **Edit** link and a **Delete** button; a new `/workout/[id]/edit` route re-uses the existing `WorkoutLogger` (seeded with the saved data) to mutate sets/exercises, and a user-scoped `updateWorkout` replaces the workout's children atomically. Delete is a user-scoped cascade. Both writes go through the `src/db/workouts.ts` authorization boundary and revalidate the affected paths.

## User Story
As a signed-in lifter,
I want to edit the sets/exercises of a past workout or delete it entirely,
So that I can fix mistakes in my logs and remove sessions I logged by accident.

## Problem → Solution
The app can create and review workouts, but a saved session is immutable — a mistyped weight or an accidental session is stuck forever. → Add an edit flow (re-using the logging UI hydrated from the saved workout, persisted via a transactional `updateWorkout` that replaces children) and a delete flow (user-scoped cascade delete), both surfaced from the detail page.

## Metadata
- **Complexity**: Medium–Large (~11 files; recommend two commits — delete, then edit — inside one phase PR; see Notes)
- **Source PRD**: `.claude/PRPs/prds/workout-tracker-pwa.prd.md`
- **PRD Phase**: Phase 5 — Edit & delete
- **Estimated Files**: 11 (3 create, 7 update, 1 e2e)

---

## UX Design

### Before
```
Detail (/workout/[id]) — read only
┌─────────────────────────────────┐
│ ← Back              Leg Day      │
│ Jun 14, 2026                    │
│ ┌─────────────────────────────┐ │
│ │ Squat                       │ │
│ │   Set 1   5 × 100 kg        │ │
│ │   Set 2   5 × 100 kg        │ │
│ └─────────────────────────────┘ │
│         (no way to change it)    │
└─────────────────────────────────┘
```

### After
```
Detail (/workout/[id])                   Edit (/workout/[id]/edit)
┌─────────────────────────────────┐      ┌─────────────────────────────────┐
│ ← Back              Leg Day      │      │ Edit Workout            Cancel   │
│ Jun 14, 2026                    │      │ [ Leg Day                     ]  │
│ ┌─────────────────────────────┐ │      │ [ Search exercises…           ]  │
│ │ Squat                       │ │      │ ┌─────────────────────────────┐ │
│ │   Set 1   5 × 100 kg        │ │ Edit │ │ Squat              Remove    │ │
│ │   Set 2   5 × 100 kg        │ │ ───► │ │ Set 1 [5 ][100 ]        ✕    │ │
│ └─────────────────────────────┘ │      │ │ Set 2 [5 ][100 ]        ✕    │ │
│ ┌──────────┐ ┌──────────┐       │      │ │           + Add set         │ │
│ │   Edit   │ │  Delete  │       │      │ └─────────────────────────────┘ │
│ └──────────┘ └──────────┘       │      │ [        Save changes        ]   │
└─────────────────────────────────┘      └─────────────────────────────────┘
   Delete → confirm() → home, row gone     Save → back to detail, updated
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Detail page | Read-only, Back link only | Adds an **Edit** link (→ `/workout/[id]/edit`) and a **Delete** button | New client `WorkoutActions` island; the page stays a Server Component |
| Delete | N/A | `window.confirm()` → `deleteWorkoutAction` → `router.push('/')` | Cascade removes children; `revalidatePath('/')` so the row is gone from history |
| Edit page | Did not exist | Re-uses `WorkoutLogger` seeded with the saved workout; Save persists and returns to detail | 404 if not found / not owned; "Save changes" replaces the whole exercise/set tree atomically |
| Save (logger) | Create only → `/` | Create → `/` (unchanged); Edit → `updateWorkoutAction` → `/workout/[id]` | One component, two modes via a `workoutId` prop |

---

## ⚠️ Key Decisions (resolve ambiguity up front)
1. **Edit = replace children, not diff.** `updateWorkout(userId, id, input)` runs in ONE `db.transaction`: (a) `update workouts set name=… where id=… and user_id=…` returning the id (this is BOTH the ownership check and the name edit), (b) if no row came back → `return null` (not found / not owned, nothing mutated), (c) `delete from workout_exercises where workout_id=id` (cascade removes its sets), (d) re-insert exercises+sets from the validated input. Replacing is dramatically simpler than diffing for a POC and is safe because it is atomic and user-scoped.
2. **Re-use `WorkoutLogger`, don't fork it.** Add three optional props (`workoutId?`, `initialDraft?`, `initialName?`). When `workoutId` is set the component is in edit mode: Save calls `updateWorkoutAction` and routes to `/workout/[id]`; otherwise it behaves exactly as today (create → `/`). The reducer/mapper are untouched.
3. **Hydrate the form with a pure mapper.** `detailToDraft(workout)` (added to `workout-draft.ts`, next to `draftToInput`) turns a `WorkoutDetail` into `{ draft, name }`, converting numbers→strings and `null`→`''`, and **re-uses the persisted row UUIDs as the draft's client ids** (stable, unique — perfect for React keys). It is pure (no `crypto.randomUUID()`), so it is server-safe and unit-testable.
4. **`category` is not persisted**, so edit drafts carry `category: ''`. The logger's exercise header must render the ` · category` segment only when category is truthy (a one-line conditional) so edit mode doesn't show a dangling "Squat · ".
5. **Writes mutate + revalidate; the client navigates.** Mirror the existing create flow: actions call `revalidatePath(...)` and return, and the client component does `router.push(...)`. Do **not** call `redirect()` inside an action that the client wraps in `try/catch` — `redirect()` throws `NEXT_REDIRECT`, which the catch would mistake for a failure.
6. **Delete is user-scoped at the source.** `deleteWorkout(userId, id)` filters `and(id, userId)`; the FK `onDelete: 'cascade'` (already in the schema) removes `workout_exercises` and `sets`. Re-using the existing single authorization boundary — no per-child filtering needed.
7. **DRY the insert loop.** Extract the exercise/set insert loop shared by `saveWorkout` and `updateWorkout` into a private `insertWorkoutChildren(tx, workoutId, exercises)`. This is in-scope (both transactions need it), keeps the two write paths identical, and leaves `save-workout.test.ts` green because the insert order/values are unchanged. (Fallback if the `tx` type is awkward: inline the loop in both — documented in the task GOTCHA.)
8. **No new dependencies, no dialog library.** Confirmation is `window.confirm()`; delete errors render inline (`text-destructive`), matching the logger's error style. shadcn's dialog isn't installed and isn't worth adding for a POC.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/workouts.ts` | 1-118 | The authorization-boundary module to EXTEND. Mirror the doc-comment + user-scoping style; `saveWorkout` (86-118) is the transaction template for `updateWorkout` and the source of the loop to extract |
| P0 | `src/db/schema.ts` | 26-46 | `workout_exercises`/`sets` FKs are `onDelete: 'cascade'` — deleting a workout (or a workout's exercises) removes children automatically |
| P0 | `src/app/workout/actions.ts` | 1-22 | The Server Action pattern to mirror: `requireUserId()` → `parseWorkoutInput` → DB call → `revalidatePath` → return. Add `updateWorkoutAction`/`deleteWorkoutAction` here |
| P0 | `src/app/workout/new/workout-logger.tsx` | 1-137 | The client logger to PARAMETERIZE (initial state + edit mode). Note `useReducer`/`useState` init (19-23), `handleSave` (27-37), exercise header (57-60) |
| P0 | `src/app/workout/new/workout-draft.ts` | 1-147 | Where `detailToDraft` goes (next to `draftToInput`, 137-146); reuse the `DraftSet`/`DraftExercise`/`WorkoutDraft` shapes and the "every case returns fresh objects" rule |
| P0 | `src/app/workout/[id]/page.tsx` | 1-60 | The detail Server Component to UPDATE — add the `<WorkoutActions>` island after the exercises |
| P1 | `src/db/save-workout.test.ts` | 1-101 | The recording-stub idiom for a transactional write test — `update-workout.test.ts` extends it with `update`/`delete` stubs |
| P1 | `src/db/workouts.test.ts` | 1-37 | The `.toSQL()` user-scoping assertion idiom — add one for `deleteWorkout` |
| P1 | `src/app/workout/new/workout-draft.test.ts` | 97-150 | `draftToInput` test shape to mirror for `detailToDraft` |
| P1 | `src/app/workout/new/page.tsx` | 1-21 | Server-component shell + header/Cancel link convention for the edit page |
| P1 | `src/lib/workout-input.ts` | 36-119 | `parseWorkoutInput` (re-used unchanged for the update path) — note: requires ≥1 exercise, so edit can't save an empty workout |
| P1 | `src/components/ui/button.tsx` | 9-58 | `variant: 'destructive'` and `'outline'`, plus `buttonVariants` (exported, line 58) for the Edit `<Link>` |
| P2 | `e2e/workout.spec.ts` | 1-104 | Live-env e2e harness (disposable Clerk user + direct Postgres assertions/cleanup) to extend with edit+delete |
| P2 | `.claude/PRPs/plans/completed/history-and-detail.plan.md` | 525-531 | Phase 4 hand-off notes that scoped this phase (detail page hosts Edit/Delete; `getWorkoutDetail` returns the editable tree) |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Drizzle delete + returning | `drizzle-orm/postgres-js` | `db.delete(t).where(and(eq(t.id,id),eq(t.userId,uid))).returning({id:t.id})` returns a builder with `.toSQL()`; the resolved array is `[]` when nothing matched |
| Drizzle update in a tx | `drizzle-orm` | `tx.update(t).set({…}).where(and(…)).returning({id})` — use the returned row as the atomic ownership gate before deleting/re-inserting children |
| Drizzle tx callback type | `drizzle-orm` | The tx type can be lifted without importing internals: `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]` |
| `revalidatePath` for dynamic routes | `next/cache` (Next 16.2.9) | Pass the concrete path (`` `/workout/${id}` ``) to refresh that detail page; pass `'/'` for the history list |
| Server Actions + client `redirect` gotcha | Next App Router | `redirect()`/`notFound()` throw control-flow errors; a client `try/catch` around the action would swallow them — return from the action and navigate with `useRouter().push` instead |
| Next 16 dynamic `params` | App Router | `params` is a `Promise<{ id: string }>` — type and `await` it (same as the detail page) |

> No further external research needed — feature uses established internal patterns plus the verified Drizzle/Next APIs above.

---

## Patterns to Mirror

### REPOSITORY_USER_SCOPING (query builder filtered by userId)
```ts
// SOURCE: src/db/workouts.ts:52-62 (getWorkoutDetail) and :16-22 (listWorkouts)
return db.query.workouts.findFirst({
  where: and(eq(workouts.id, id), eq(workouts.userId, userId)),
  ...
})
```
→ `deleteWorkout(userId, id)` filters `and(id, userId)`; `updateWorkout` filters the same on its `update`.

### TRANSACTIONAL_WRITE (atomic tree write, owner-stamped)
```ts
// SOURCE: src/db/workouts.ts:86-118 (saveWorkout)
export async function saveWorkout(userId, input) {
  return db.transaction(async (tx) => {
    const [workout] = await tx.insert(workouts).values({ userId, name: input.name }).returning({ id: workouts.id })
    for (const [position, exercise] of input.exercises.entries()) {
      const [we] = await tx.insert(workoutExercises).values({ workoutId: workout.id, ... , position }).returning({ id: workoutExercises.id })
      if (exercise.sets.length > 0) {
        await tx.insert(sets).values(exercise.sets.map((s, i) => ({ workoutExerciseId: we.id, setNumber: i + 1, reps: s.reps, weight: s.weight })))
      }
    }
    return { id: workout.id }
  })
}
```
→ `updateWorkout` mirrors this: `tx.update` (ownership gate) → `tx.delete` children → re-insert via the shared `insertWorkoutChildren`.

### SERVER_ACTION (gate → validate → mutate → revalidate → return)
```ts
// SOURCE: src/app/workout/actions.ts:16-22 (saveWorkoutAction)
export async function saveWorkoutAction(input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseWorkoutInput(input)
  const result = await saveWorkout(userId, parsed)
  revalidatePath('/')
  return result
}
```
→ `updateWorkoutAction(id, input)` adds `revalidatePath(\`/workout/${id}\`)`; `deleteWorkoutAction(id)` calls `deleteWorkout` then `revalidatePath('/')`.

### CLIENT_MUTATION_ISLAND (transition + try/catch + router.push)
```ts
// SOURCE: src/app/workout/new/workout-logger.tsx:20-37
const [isPending, startTransition] = useTransition()
const router = useRouter()
function handleSave() {
  startTransition(async () => {
    try { setError(null); await saveWorkoutAction(draftToInput(draft, name)); router.push('/') }
    catch { setError('Could not save workout. Please try again.') }
  })
}
```
→ `WorkoutActions` delete handler and the logger's edit-mode save mirror this exactly (inline `text-destructive` error, disabled-while-pending button).

### TEST_TOSQL (user-scoping assertion, no DB)
```ts
// SOURCE: src/db/workouts.test.ts:32-36
const { sql, params } = getWorkoutDetail(USER, WORKOUT_ID).toSQL()
expect(sql).toContain('"user_id"')
expect(params).toEqual(expect.arrayContaining([USER, WORKOUT_ID]))
```
→ same idiom for `deleteWorkout(USER, ID)`.

### TEST_RECORDING_STUB (transactional write, no DB)
```ts
// SOURCE: src/db/save-workout.test.ts:11-34 — stub tx.insert(...).values(v).returning() to record v
vi.mock('./index', () => ({ db: { transaction: (cb) => cb(makeTx()) } }))
```
→ `update-workout.test.ts` extends `makeTx()` with `update()`/`delete()` recorders to assert ownership filter + child replacement.

### PURE_MAPPER_TESTABLE
```ts
// SOURCE: src/app/workout/new/workout-draft.ts:137-146 (draftToInput) — pure, unit-tested
```
→ `detailToDraft` is pure (reuses persisted ids, no `crypto`), unit-tested alongside `draftToInput`.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/workouts.ts` | UPDATE | Add `deleteWorkout(userId, id)`, `updateWorkout(userId, id, input)`, and extract private `insertWorkoutChildren(tx, workoutId, exercises)` shared with `saveWorkout` |
| `src/db/workouts.test.ts` | UPDATE | Add a `.toSQL()` user-scoping test for `deleteWorkout` |
| `src/db/update-workout.test.ts` | CREATE | Recording-stub test for `updateWorkout`: ownership gate, child delete, ordered re-insert, not-owned → null (no inserts) |
| `src/app/workout/actions.ts` | UPDATE | Add `updateWorkoutAction(id, input)` and `deleteWorkoutAction(id)` |
| `src/app/workout/new/workout-draft.ts` | UPDATE | Add pure `detailToDraft(workout)` mapper |
| `src/app/workout/new/workout-draft.test.ts` | UPDATE | Unit-test `detailToDraft` (number→string, null→'', name fallback, id reuse, empty category) |
| `src/app/workout/new/workout-logger.tsx` | UPDATE | Accept `workoutId?`/`initialDraft?`/`initialName?`; edit-mode save → `updateWorkoutAction` → `/workout/[id]`; render category segment only when present; edit-mode button label |
| `src/app/workout/[id]/workout-actions.tsx` | CREATE | Client island: Edit `<Link>` + Delete `<Button variant="destructive">` with confirm + inline error |
| `src/app/workout/[id]/page.tsx` | UPDATE | Render `<WorkoutActions id={workout.id} />` below the exercise list |
| `src/app/workout/[id]/edit/page.tsx` | CREATE | Server Component: `getWorkoutDetail` → `notFound()` if missing → `detailToDraft` → `<WorkoutLogger workoutId initialDraft initialName>` |
| `e2e/edit-delete.spec.ts` | CREATE | Live-env e2e: seed a workout, edit a set's weight (assert in Postgres), delete it (assert rows gone) |

## NOT Building
- **Per-set / per-exercise inline editing on the detail page** — edit happens on the dedicated `/edit` route via the existing logger (KISS).
- **Diff-based partial updates** — edit replaces the workout's children atomically (POC scale).
- **Undo / soft-delete / trash** — delete is a hard cascade (PRD: "delete a workout (cascade its children)").
- **Editing `started_at`/`createdAt` or marking `completed`** — only name + exercises + sets are editable; timestamps are preserved.
- **A confirmation modal component** — `window.confirm()` is sufficient; no dialog dependency added.
- **Changing the create flow's destination** — create still routes to `/`; only edit routes to the detail page.
- **Optimistic UI / rollback** — server round-trip then navigate, consistent with create.

---

## Step-by-Step Tasks

### Task 1: Delete + update queries (`src/db/workouts.ts` — UPDATE)
- **ACTION**: Add `deleteWorkout`, `updateWorkout`, and extract the shared insert loop into `insertWorkoutChildren`.
- **IMPLEMENT**:
  ```ts
  // tx type lifted from the transaction callback (no internal import needed)
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

  /** Inserts a workout's exercises + sets (shared by saveWorkout and updateWorkout). */
  async function insertWorkoutChildren(tx: Tx, workoutId: string, exercises: WorkoutInput['exercises']) {
    for (const [position, exercise] of exercises.entries()) {
      const [we] = await tx
        .insert(workoutExercises)
        .values({ workoutId, wgerExerciseId: exercise.wgerExerciseId, name: exercise.name, position })
        .returning({ id: workoutExercises.id })
      if (exercise.sets.length > 0) {
        await tx.insert(sets).values(
          exercise.sets.map((s, i) => ({
            workoutExerciseId: we.id,
            setNumber: i + 1,
            reps: s.reps,
            weight: s.weight,
          })),
        )
      }
    }
  }

  /** Deletes a workout (and its children, via FK cascade) only if owned by the user. */
  export function deleteWorkout(userId: string, id: string) {
    return db
      .delete(workouts)
      .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
      .returning({ id: workouts.id })
  }

  /**
   * Replaces a workout's name + exercises/sets atomically, only if owned by the
   * user. The `update ... returning` doubles as the ownership gate: if no row
   * comes back the caller doesn't own it (or it's gone) and nothing is mutated.
   * Children are deleted (cascade removes their sets) and re-inserted from input.
   */
  export async function updateWorkout(
    userId: string,
    id: string,
    input: WorkoutInput,
  ): Promise<{ id: string } | null> {
    return db.transaction(async (tx) => {
      const [owned] = await tx
        .update(workouts)
        .set({ name: input.name ?? null })
        .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
        .returning({ id: workouts.id })
      if (!owned) return null

      await tx.delete(workoutExercises).where(eq(workoutExercises.workoutId, id))
      await insertWorkoutChildren(tx, id, input.exercises)
      return { id }
    })
  }
  ```
  Then refactor `saveWorkout`'s loop body (lines 93-113) to a single call:
  ```ts
  const [workout] = await tx.insert(workouts).values({ userId, name: input.name }).returning({ id: workouts.id })
  await insertWorkoutChildren(tx, workout.id, input.exercises)
  return { id: workout.id }
  ```
- **MIRROR**: TRANSACTIONAL_WRITE (`saveWorkout`, 86-118); REPOSITORY_USER_SCOPING.
- **IMPORTS**: `and`, `eq` are already imported (line 1); `workouts`, `workoutExercises`, `sets` already imported (line 4); `WorkoutInput` already imported as a type (line 2). No new imports.
- **GOTCHA**: `.set({ name: input.name ?? null })` — `WorkoutInput.name` is optional, so an edit that clears the name writes `null` (matches the nullable column). The `update().returning()` must be the FIRST statement and the early `return null` must short-circuit before any delete/insert, so a foreign id mutates nothing. `db.delete(workoutExercises)` cascades to `sets` (schema FK), so don't delete `sets` separately. If the `Tx` type extraction misbehaves under your TS version, fall back to inlining the loop in both `saveWorkout` and `updateWorkout` (duplication acceptable; keeps `save-workout.test.ts` green either way since insert order is unchanged).
- **VALIDATE**: `npx tsc --noEmit`; `npx vitest run src/db/save-workout.test.ts` (must still pass after the extraction).

### Task 2: Delete user-scoping test (`src/db/workouts.test.ts` — UPDATE)
- **ACTION**: Add a `.toSQL()` test proving `deleteWorkout` filters by id AND user.
- **IMPLEMENT** (extend the existing import + `describe`, keep current tests intact):
  ```ts
  import { /* …existing… */ deleteWorkout } from './workouts'

  it('scopes the delete to the user as well as the id', () => {
    const { sql, params } = deleteWorkout(USER, WORKOUT_ID).toSQL()
    expect(sql).toContain('"user_id"')
    expect(params).toEqual(expect.arrayContaining([USER, WORKOUT_ID]))
  })
  ```
- **MIRROR**: TEST_TOSQL (`src/db/workouts.test.ts:32-36`).
- **IMPORTS**: add `deleteWorkout` to the existing import block; `USER`/`WORKOUT_ID` constants already defined.
- **GOTCHA**: This is the unmocked `.toSQL()` file — the builder serializes lazily and never opens a socket (dummy `DATABASE_URL` from `vitest.setup.ts`). Don't test `updateWorkout` here (it's a transaction, not a single builder) — that's Task 3.
- **VALIDATE**: `npx vitest run src/db/workouts.test.ts`.

### Task 3: Update transaction test (`src/db/update-workout.test.ts` — CREATE)
- **ACTION**: Recording-stub test for `updateWorkout` covering the happy path and the not-owned path.
- **IMPLEMENT**: mirror `save-workout.test.ts` but extend `makeTx()` so `tx.update`, `tx.delete`, and `tx.insert` all record. The `update().set().where().returning()` chain returns a configurable row so a test can simulate "owned" (`[{ id }]`) vs "not owned" (`[]`).
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  const records: { op: string; values?: unknown }[] = []
  let ownedRow: { id: string }[] = [{ id: 'w1' }] // toggle to [] for not-owned
  let idCounter = 0
  const ID_SEQUENCE = ['e1', 's1', 'e2'] // exercise/set ids for re-insert

  function makeTx() {
    return {
      update: () => ({
        set: (values: unknown) => ({
          where: () => ({ returning: () => { records.push({ op: 'update', values }); return Promise.resolve(ownedRow) } }),
        }),
      }),
      delete: () => ({ where: () => { records.push({ op: 'delete' }); return Promise.resolve() } }),
      insert: () => ({
        values: (values: unknown) => {
          records.push({ op: 'insert', values })
          return { returning: () => Promise.resolve([{ id: ID_SEQUENCE[idCounter++] }]) }
        },
      }),
    }
  }

  vi.mock('./index', () => ({
    db: { transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()) },
  }))

  import { updateWorkout } from './workouts'
  const USER = 'user_123'
  const ID = '11111111-1111-1111-1111-111111111111'

  beforeEach(() => { records.length = 0; idCounter = 0; ownedRow = [{ id: 'w1' }] })

  describe('updateWorkout (transactional, user-scoped)', () => {
    it('updates the name, clears children, then re-inserts in order', async () => {
      const result = await updateWorkout(USER, ID, {
        name: 'New name',
        exercises: [{ wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 5, weight: 100 }] }],
      })
      expect(records[0]).toEqual({ op: 'update', values: { name: 'New name' } })
      expect(records[1].op).toBe('delete')
      expect(records[2]).toMatchObject({ op: 'insert', values: { workoutId: ID, wgerExerciseId: 73, name: 'Squat', position: 0 } })
      expect(records[3]).toEqual({ op: 'insert', values: [{ workoutExerciseId: 'e1', setNumber: 1, reps: 5, weight: 100 }] })
      expect(result).toEqual({ id: ID })
    })

    it('clears the name to null when input has none', async () => {
      await updateWorkout(USER, ID, { exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }] })
      expect(records[0]).toEqual({ op: 'update', values: { name: null } })
    })

    it('returns null and mutates nothing when the user does not own the workout', async () => {
      ownedRow = []
      const result = await updateWorkout(USER, ID, {
        exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }],
      })
      expect(result).toBeNull()
      expect(records).toEqual([{ op: 'update', values: { name: null } }]) // no delete, no insert
    })
  })
  ```
- **MIRROR**: TEST_RECORDING_STUB (`src/db/save-workout.test.ts:11-41`).
- **IMPORTS**: `vitest`; `updateWorkout` from `./workouts`.
- **GOTCHA**: Reset `ownedRow` in `beforeEach` so the not-owned test doesn't leak. The not-owned assertion is the security-critical one: the early `return null` must run BEFORE any `delete`/`insert`. `where()` in the stubs ignores args (the `.toSQL()` test in Task 2 already proves the user/id filter); this test asserts control flow + written values.
- **VALIDATE**: `npx vitest run src/db/update-workout.test.ts`.

### Task 4: Server Actions (`src/app/workout/actions.ts` — UPDATE)
- **ACTION**: Add `updateWorkoutAction` and `deleteWorkoutAction`.
- **IMPLEMENT**:
  ```ts
  import { updateWorkout, deleteWorkout, saveWorkout } from '@/db/workouts'

  /** Validates and applies an edit to an owned workout, returning its id. */
  export async function updateWorkoutAction(id: string, input: unknown): Promise<{ id: string }> {
    const userId = await requireUserId()
    const parsed = parseWorkoutInput(input)
    const result = await updateWorkout(userId, id, parsed)
    if (!result) throw new Error('workout not found')
    revalidatePath('/')
    revalidatePath(`/workout/${id}`)
    return result
  }

  /** Deletes an owned workout (cascade); the client navigates home after. */
  export async function deleteWorkoutAction(id: string): Promise<void> {
    const userId = await requireUserId()
    await deleteWorkout(userId, id)
    revalidatePath('/')
  }
  ```
- **MIRROR**: SERVER_ACTION (`saveWorkoutAction`, 16-22).
- **IMPORTS**: extend the existing `import { saveWorkout } from '@/db/workouts'` to include `updateWorkout, deleteWorkout`. `requireUserId`, `parseWorkoutInput`, `revalidatePath` already imported.
- **GOTCHA**: Do NOT `redirect('/')` inside `deleteWorkoutAction` — the client wraps the call in `try/catch`, and `redirect()` throws `NEXT_REDIRECT` which the catch would treat as a failure. Return void and let the client `router.push('/')`. `updateWorkoutAction` throws a plain `Error` on not-owned (the edit page only renders for owned workouts; this is the concurrent-delete edge) so the client's catch shows the inline error. `id` is the route param that produced the page, so no extra id validation is needed (an invalid uuid would surface as a caught DB error).
- **VALIDATE**: `npx tsc --noEmit`.

### Task 5: Hydration mapper (`src/app/workout/new/workout-draft.ts` — UPDATE)
- **ACTION**: Add a pure `detailToDraft` that seeds the logger from a saved workout.
- **IMPLEMENT** (add after `draftToInput`):
  ```ts
  import type { WorkoutDetail } from '@/db/workouts'

  /**
   * Seeds an editable draft from a persisted workout (the inverse of
   * draftToInput). Numbers become input strings (`null` → `''`); the persisted
   * row UUIDs are reused as the draft's client ids (stable React keys). `category`
   * is not a persisted column, so it comes back empty.
   */
  export function detailToDraft(workout: WorkoutDetail): { draft: WorkoutDraft; name: string } {
    const exercises = workout.exercises.map((exercise) => ({
      id: exercise.id,
      wgerExerciseId: exercise.wgerExerciseId,
      name: exercise.name,
      category: '',
      sets: exercise.sets.map((set) => ({
        id: set.id,
        reps: set.reps?.toString() ?? '',
        weight: set.weight?.toString() ?? '',
      })),
    }))
    return { draft: { exercises }, name: workout.name ?? '' }
  }
  ```
- **MIRROR**: PURE_MAPPER_TESTABLE (`draftToInput`, 137-146).
- **IMPORTS**: add a TYPE-ONLY import `import type { WorkoutDetail } from '@/db/workouts'` (type-only → stripped at build, so no db runtime leaks into the client bundle).
- **GOTCHA**: Keep it pure — do NOT call `crypto.randomUUID()` here (reuse the persisted ids), so the module stays server-safe (the edit Server Component imports it). `set.weight` is `numeric(mode:'number')` → `number | null`; `2.5` round-trips as `"2.5"`. Use optional-chaining `?.toString() ?? ''` because reps/weight are nullable.
- **VALIDATE**: `npx tsc --noEmit`; covered by Task 6.

### Task 6: Mapper test (`src/app/workout/new/workout-draft.test.ts` — UPDATE)
- **ACTION**: Unit-test `detailToDraft`.
- **IMPLEMENT** (new `describe`, AAA; construct a minimal `WorkoutDetail`-shaped object):
  ```ts
  import { /* …existing… */ detailToDraft } from './workout-draft'

  describe('detailToDraft', () => {
    it('maps a saved workout to an editable draft (numbers→strings, null→"", ids reused)', () => {
      const workout = {
        id: 'w1', userId: 'user_123', name: 'Leg Day',
        startedAt: new Date(), completedAt: null, createdAt: new Date(),
        exercises: [
          { id: 'ex1', workoutId: 'w1', wgerExerciseId: 73, name: 'Squat', position: 0,
            sets: [
              { id: 's1', workoutExerciseId: 'ex1', setNumber: 1, reps: 5, weight: 2.5, completed: false },
              { id: 's2', workoutExerciseId: 'ex1', setNumber: 2, reps: null, weight: null, completed: false },
            ] },
        ],
      }
      const { draft, name } = detailToDraft(workout as never)
      expect(name).toBe('Leg Day')
      expect(draft.exercises[0]).toMatchObject({ id: 'ex1', wgerExerciseId: 73, name: 'Squat', category: '' })
      expect(draft.exercises[0].sets).toEqual([
        { id: 's1', reps: '5', weight: '2.5' },
        { id: 's2', reps: '', weight: '' },
      ])
    })

    it('falls back to an empty name when the workout has none', () => {
      const workout = { name: null, exercises: [] }
      expect(detailToDraft(workout as never).name).toBe('')
    })
  })
  ```
- **MIRROR**: `draftToInput` tests (97-132).
- **IMPORTS**: add `detailToDraft` to the existing import.
- **GOTCHA**: Cast the literal to the param type (`as never`/`as WorkoutDetail`) to avoid hand-typing every column — the test only exercises the fields the mapper reads. Round-trip note: `draftToInput(detailToDraft(w).draft, name)` should reproduce the persisted numbers (optional extra assertion).
- **VALIDATE**: `npx vitest run src/app/workout/new/workout-draft.test.ts`.

### Task 7: Parameterize the logger (`src/app/workout/new/workout-logger.tsx` — UPDATE)
- **ACTION**: Add edit-mode props and branch the save; render category only when present.
- **IMPLEMENT**:
  - Add a props interface and defaults:
    ```ts
    import { saveWorkoutAction, updateWorkoutAction } from '@/app/workout/actions'
    import { workoutDraftReducer, draftToInput, emptyDraft, newDraftExercise, newDraftSet,
             type WorkoutDraft } from './workout-draft'

    interface WorkoutLoggerProps {
      workoutId?: string            // present → edit mode
      initialDraft?: WorkoutDraft
      initialName?: string
    }

    export function WorkoutLogger({ workoutId, initialDraft = emptyDraft, initialName = '' }: WorkoutLoggerProps) {
      const [draft, dispatch] = useReducer(workoutDraftReducer, initialDraft)
      const [name, setName] = useState(initialName)
      // …error/isPending/router unchanged…
    ```
  - Branch the save:
    ```ts
    function handleSave() {
      startTransition(async () => {
        try {
          setError(null)
          if (workoutId) {
            await updateWorkoutAction(workoutId, draftToInput(draft, name))
            router.push(`/workout/${workoutId}`)
          } else {
            await saveWorkoutAction(draftToInput(draft, name))
            router.push('/')
          }
        } catch {
          setError('Could not save workout. Please try again.')
        }
      })
    }
    ```
  - Conditional category in the exercise header (replace lines 57-60):
    ```tsx
    <CardTitle className="text-base">
      {exercise.name}
      {exercise.category && (
        <span className="font-normal text-muted-foreground"> · {exercise.category}</span>
      )}
    </CardTitle>
    ```
  - Save button label: use `'Save changes'` when `workoutId` is set, else `'Save workout'` (keep `'Saving…'` while pending).
- **MIRROR**: CLIENT_MUTATION_ISLAND (existing `handleSave`, 27-37).
- **IMPORTS**: add `updateWorkoutAction` to the actions import; add `type WorkoutDraft` to the draft import.
- **GOTCHA**: `useReducer(reducer, initialDraft)` reads the prop only on mount — exactly the desired behavior (the form owns state after). The `initialDraft`/`initialName` props arrive from a Server Component as plain serializable values, which is required across the boundary. Create behavior is unchanged when `workoutId` is undefined (still `→ '/'`). The empty-guard (`isEmpty` disables Save) still applies, so an edit can't be saved with zero exercises (matches `parseWorkoutInput`).
- **VALIDATE**: `npx tsc --noEmit`; `npm run build`; manual: the create flow at `/workout/new` still works unchanged.

### Task 8: Detail-page action island (`src/app/workout/[id]/workout-actions.tsx` — CREATE)
- **ACTION**: Client component with the Edit link + Delete button.
- **IMPLEMENT**:
  ```tsx
  'use client'

  import Link from 'next/link'
  import { useState, useTransition } from 'react'
  import { useRouter } from 'next/navigation'
  import { Button, buttonVariants } from '@/components/ui/button'
  import { cn } from '@/lib/utils'
  import { deleteWorkoutAction } from '@/app/workout/actions'

  export function WorkoutActions({ id }: { id: string }) {
    const [isPending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()

    function handleDelete() {
      if (!window.confirm('Delete this workout? This cannot be undone.')) return
      startTransition(async () => {
        try {
          setError(null)
          await deleteWorkoutAction(id)
          router.push('/')
        } catch {
          setError('Could not delete workout. Please try again.')
        }
      })
    }

    return (
      <div className="mt-6 space-y-2">
        <div className="flex gap-2">
          <Link
            href={`/workout/${id}/edit`}
            className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
          >
            Edit
          </Link>
          <Button
            variant="destructive"
            className="flex-1"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }
  ```
- **MIRROR**: CLIENT_MUTATION_ISLAND; `buttonVariants` link usage (`src/app/workout/new/page.tsx:14`).
- **IMPORTS**: as shown. `buttonVariants` is exported from `@/components/ui/button` (line 58).
- **GOTCHA**: `window.confirm` is browser-only — fine here ('use client'). Return void from `deleteWorkoutAction` and navigate client-side (don't `redirect` server-side; see Task 4). Keep the island tiny so the detail page stays a Server Component.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 9: Wire actions into the detail page (`src/app/workout/[id]/page.tsx` — UPDATE)
- **ACTION**: Render `<WorkoutActions>` below the exercise list.
- **IMPLEMENT**: import `import { WorkoutActions } from './workout-actions'`; after the closing `</div>` of the exercises block (line 57) and before `</main>`, add:
  ```tsx
  <WorkoutActions id={workout.id} />
  ```
- **MIRROR**: existing detail page composition.
- **IMPORTS**: add the `WorkoutActions` import.
- **GOTCHA**: The page stays a Server Component (no `'use client'`); it just renders the client island, passing the already-fetched `workout.id`. No other change.
- **VALIDATE**: `npm run build`; manual: Edit + Delete appear on a detail page.

### Task 10: Edit page (`src/app/workout/[id]/edit/page.tsx` — CREATE)
- **ACTION**: Server Component that hydrates the logger in edit mode.
- **IMPLEMENT**:
  ```tsx
  import Link from 'next/link'
  import { notFound } from 'next/navigation'
  import { requireUserId } from '@/lib/auth'
  import { getWorkoutDetail } from '@/db/workouts'
  import { detailToDraft } from '@/app/workout/new/workout-draft'
  import { WorkoutLogger } from '@/app/workout/new/workout-logger'
  import { buttonVariants } from '@/components/ui/button'
  import { cn } from '@/lib/utils'

  export default async function EditWorkoutPage({
    params,
  }: {
    params: Promise<{ id: string }>
  }) {
    const userId = await requireUserId()
    const { id } = await params
    const workout = await getWorkoutDetail(userId, id)
    if (!workout) notFound()

    const { draft, name } = detailToDraft(workout)

    return (
      <main className="mx-auto w-full max-w-md p-6">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Edit Workout</h1>
          <Link
            href={`/workout/${id}`}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Cancel
          </Link>
        </header>
        <WorkoutLogger workoutId={id} initialDraft={draft} initialName={name} />
      </main>
    )
  }
  ```
- **MIRROR**: SERVER_COMPONENT_SHELL (`src/app/workout/new/page.tsx`); detail page's `params`/`notFound` handling.
- **IMPORTS**: as shown.
- **GOTCHA**: `params` is a Promise in Next 16 — `await` it. `getWorkoutDetail` is already user-scoped, so a foreign/unknown id → `undefined` → `notFound()` (no info leak; same as detail). Importing `WorkoutLogger` (a client component) and `detailToDraft` (pure) from the `new/` folder is intentional reuse — no duplication. Cancel returns to the detail page (not home), since you came from there.
- **VALIDATE**: `npm run build` (route list includes `/workout/[id]/edit`); manual: Edit opens the form pre-filled.

### Task 11: E2E edit + delete (`e2e/edit-delete.spec.ts` — CREATE)
- **ACTION**: Live-env happy path: create a workout (UI), edit a set's weight, assert in Postgres, then delete and assert the rows are gone.
- **IMPLEMENT**: copy the harness from `e2e/workout.spec.ts` (disposable `+clerk_test` user via Backend API, `clerk.signIn`, direct Postgres via `DATABASE_URL_DIRECT`, teardown deletes workouts + Clerk user). Steps:
  1. Sign in; Start Workout; search `bench`; Add; log Set 1 (`5` × `100`); Save → home.
  2. Open the workout from History (`page.getByRole('link', { name: /bench|workout/i }).first()`), click **Edit**, change `Set 1 weight in kg` to `105`, click **Save changes**, expect URL `/workout/<id>`.
  3. Assert in Postgres: `select weight from sets …` returns `105`.
  4. Register `page.on('dialog', d => d.accept())`, click **Delete**, expect URL `/`.
  5. Assert in Postgres: `select count(*) from workouts where user_id = $userId` is `0`.
- **MIRROR**: `e2e/workout.spec.ts` (1-104) end-to-end.
- **IMPORTS**: same as `workout.spec.ts` (`@playwright/test`, `@clerk/testing/playwright`, `postgres`).
- **GOTCHA**: Register the `dialog` handler BEFORE clicking Delete (Playwright auto-dismisses dialogs otherwise). This suite needs live Clerk + Supabase env (`CLERK_SECRET_KEY`, `DATABASE_URL`, `DATABASE_URL_DIRECT`) — same prerequisite as the existing e2e; it does not run in plain `npm test` (Vitest), only `npm run test:e2e`. Teardown must still delete the workout rows + Clerk user even though the test deletes the workout (idempotent: `delete … where user_id = …`).
- **VALIDATE**: `npm run test:e2e` (requires live env). If the live env is unavailable, this is the only task that can't be auto-verified; the Vitest suite + build cover the rest.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| delete scoped to id+user | `deleteWorkout(USER, ID)` | SQL contains `"user_id"`; params include USER and ID | no |
| update happy path | `updateWorkout(USER, ID, {name,1 ex,1 set})` | records: update→delete→insert(ex)→insert(set); returns `{id:ID}` | no |
| update clears name | `updateWorkout(USER, ID, {no name})` | first record `update {name:null}` | yes |
| update not-owned | `ownedRow=[]` | returns `null`; only the `update` ran (no delete/insert) | yes (security) |
| detailToDraft mapping | saved workout w/ reps `5`/weight `2.5` + a null set | `{reps:'5',weight:'2.5'}` then `{reps:'',weight:''}`; ids reused; `category:''` | yes |
| detailToDraft null name | `{name:null}` | `name === ''` | yes |

### Edge Cases Checklist
- [x] Not-owned / foreign workout on edit (query → `undefined` → `notFound()`) and on update (`updateWorkout` → `null` → action throws)
- [x] Not-owned / foreign workout on delete (user-scoped `where` → 0 rows affected; no error, no leak)
- [x] Clearing the workout name on edit (`name: null`)
- [x] Sets with blank reps/weight round-trip (`null` → `''` → `null`)
- [x] Fractional weight preserved through edit (`2.5`)
- [x] Concurrent delete then save edit (`updateWorkout` returns `null` → inline error)
- [x] Cascade: deleting a workout removes its exercises + sets (FK `onDelete: 'cascade'`)
- [ ] Editing to zero exercises — prevented by the Save guard + `parseWorkoutInput` (use Delete instead)
- [ ] Pagination / large history — out of scope (POC)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors.

### Lint
```bash
npm run lint
```
EXPECT: No errors (no `console.log`).

### Unit Tests
```bash
npm test
```
EXPECT: All pass — existing suites plus `update-workout.test.ts`, the new `deleteWorkout` `.toSQL()` test, and the `detailToDraft` tests. `save-workout.test.ts` still green after the `insertWorkoutChildren` extraction.

### Build
```bash
npm run build
```
EXPECT: Build succeeds; route list includes `/workout/[id]` and the new `/workout/[id]/edit`.

### E2E (requires live Clerk + Supabase env)
```bash
npm run test:e2e
```
EXPECT: Both the existing log spec and the new edit/delete spec pass.

### Database Validation (manual — round-trip integrity, PRD metric)
```bash
# Against DATABASE_URL_DIRECT (psql / Supabase SQL editor), for an edited workout <id>:
#   select set_number, reps, weight from sets
#     where workout_exercise_id in (select id from workout_exercises where workout_id = '<id>')
#     order by set_number;            -- reflects the edit
# After delete:
#   select count(*) from workouts where id = '<id>';                  -- 0
#   select count(*) from workout_exercises where workout_id = '<id>'; -- 0 (cascade)
```
EXPECT: Edits are reflected; delete removes the workout AND its children.

### Browser Validation (signed in)
```bash
npm run dev
# Open a saved workout → Edit → change a weight → Save changes → back on detail, value updated.
# Open a saved workout → Delete → confirm → land on / → row gone from History.
# Visit /workout/<random-uuid>/edit → 404.
```
EXPECT: Edit persists and re-renders; delete removes it from history; foreign/unknown ids 404.

### Manual Validation
- [ ] Detail page shows Edit + Delete controls.
- [ ] Edit opens the logger pre-filled with the saved name, exercises, and sets.
- [ ] Changing a set's reps/weight and saving updates the detail view.
- [ ] Changing/clearing the workout name persists.
- [ ] Delete asks for confirmation; cancelling leaves the workout intact.
- [ ] Confirming delete returns home and the workout is gone from History.
- [ ] The create flow (`/workout/new`) is unchanged.
- [ ] Editing/deleting another user's (or unknown) workout 404s / fails safely.

---

## Acceptance Criteria
- [ ] The detail page exposes Edit and Delete.
- [ ] Edit re-uses the logger seeded from the saved workout; saving replaces the exercise/set tree atomically and re-renders the detail.
- [ ] Delete removes the workout and its children (cascade) and updates the history list.
- [ ] Both writes are user-scoped at `src/db/workouts.ts`; a foreign/unknown id can't be edited or deleted.
- [ ] All validation commands pass (type-check, lint, unit tests, build).
- [ ] Matches the UX design (detail → Edit/Delete; edit form → Save changes → detail).

## Completion Checklist
- [ ] Follows discovered patterns (user-scoped repo queries, transactional write, `.toSQL()` + recording-stub tests, server-action gate→validate→mutate→revalidate, client mutation island, pure mapper).
- [ ] Error handling matches codebase style (`notFound()` for missing/not-owned; inline `text-destructive`; no swallowed errors; no `redirect()` inside a caught action).
- [ ] Tests follow the repo idiom (AAA, top-of-file constants, `.toSQL()`/recording-stub assertions).
- [ ] No hardcoded values; no new runtime dependency.
- [ ] No mutation; queries/updates built immutably; reducer/mapper return fresh objects.
- [ ] `save-workout.test.ts` unaffected by the shared-helper extraction.
- [ ] PRD Phase 5 marked in-progress + linked to this plan.
- [ ] Self-contained — implementable without further codebase searching.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `redirect()` inside a server action caught by the client `try/catch` (delete silently "fails") | M | M | Action returns void + `revalidatePath`; client `router.push('/')`. Encoded in Task 4/8. |
| Extracting `insertWorkoutChildren` breaks `saveWorkout` / its test | L | M | Insert order/values unchanged → recording stub still matches; `Tx` type lifted via `Parameters<…>`; inline-duplication fallback documented. Run `save-workout.test.ts` after. |
| Edit "replace children" drops data if the transaction half-commits | L | H | All steps run in one `db.transaction` (atomic); ownership gate (`update … returning`) precedes any delete; `updateWorkout` returns `null` (no mutation) for non-owners. |
| Type-only `WorkoutDetail` import pulls db runtime into the client bundle | L | M | `import type` is stripped at build; `detailToDraft` is pure (no `crypto`/db). Verified by `npm run build`. |
| Logger regression in the create flow from new props | L | M | Props default to `emptyDraft`/`''`/`undefined` → identical create behavior; manual + e2e cover `/workout/new`. |
| `category: ''` renders a dangling " · " in edit mode | L | L | Header renders the category segment only when truthy (Task 7). |
| E2E dialog auto-dismiss makes Delete a no-op | L | M | Register `page.on('dialog', d => d.accept())` before the Delete click (Task 11). |

## Notes
- **Why replace-children for edit:** diffing sets/exercises is needless complexity at POC scale; an atomic delete-and-reinsert inside one transaction is simpler, correct, and reuses the existing insert path.
- **Why reuse `WorkoutLogger`:** the create UI already handles exercises, sets, add/remove, and validation. Three optional props turn it into the edit UI with zero new interaction code — the cheapest correct path and the smallest review surface.
- **Authorization stays in one place:** `deleteWorkout` and `updateWorkout` both filter by `userId`, so the actions/pages never re-check ownership beyond calling the scoped helper (then `notFound()`/throw on the empty result).
- **Suggested commit split (keeps each diff reviewable, < ~300 lines):**
  1. **Delete** — `deleteWorkout` + test, `deleteWorkoutAction`, `WorkoutActions` (delete only), detail-page wiring.
  2. **Edit** — `insertWorkoutChildren` extraction + `updateWorkout` + tests, `updateWorkoutAction`, `detailToDraft` + test, logger props, edit page, add Edit link to `WorkoutActions`.
  3. **E2E** — `edit-delete.spec.ts` (live env).
  All commits live under the same Phase 5 PR.
- **Phase 6 hand-off:** with the full CRUD loop done, the remaining work is PWA manifest/SW + Vercel deploy (depends only on the core loop). No edit/delete dependency.
