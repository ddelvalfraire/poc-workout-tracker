# Plan: History & Detail (Phase 4)

## Summary
Deliver the "review past workouts" half of the app's value. The home page (`/`) becomes a user-scoped **history list** — each saved session shown with its date and exercise/set counts — and a new `/workout/[id]` route renders a **session detail** view (exercises in order, each set's reps × weight). Both reads are Server Components that go through the user-scoped data-access layer in `src/db/workouts.ts`; no new write paths, no client interactivity.

## User Story
As a signed-in lifter,
I want to see a list of my past workouts and open one to view its exercises and sets,
So that I can review what I did and gauge progress.

## Problem → Solution
The app can record and persist workouts, but the home page is a placeholder ("History — coming soon.") and there is no way to view a saved session. → Add two user-scoped read queries (`listWorkoutSummaries`, `getWorkoutDetail`), render the summaries on `/`, and add a `/workout/[id]` detail page that 404s when the workout doesn't exist or isn't owned by the caller.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/workout-tracker-pwa.prd.md`
- **PRD Phase**: Phase 4 — History & detail
- **Estimated Files**: 6 (3 create, 3 update)

---

## UX Design

### Before
```
Home (/)
┌──────────────────────────┐
│ Workout Tracker     (●)  │
│                          │
│  ┌────────────────────┐  │
│  │   + Start Workout  │  │
│  └────────────────────┘  │
│                          │
│  History — coming soon.  │
└──────────────────────────┘
```

### After
```
Home (/)                            Detail (/workout/[id])
┌──────────────────────────┐        ┌─────────────────────────────────┐
│ Workout Tracker     (●)  │        │ ← Back              Leg Day      │
│                          │        │ Jun 14, 2026                    │
│  ┌────────────────────┐  │        │ ┌─────────────────────────────┐ │
│  │   + Start Workout  │  │        │ │ Squat                       │ │
│  └────────────────────┘  │        │ │   Set 1   5 × 100 kg        │ │
│                          │        │ │   Set 2   5 × 100 kg        │ │
│  History                 │        │ └─────────────────────────────┘ │
│  ┌────────────────────┐  │  tap   │ ┌─────────────────────────────┐ │
│  │ Leg Day            │──┼──────► │ │ Bench Press                 │ │
│  │ Jun 14 · 2 ex · 6  │  │        │ │   Set 1   8 × 60 kg         │ │
│  └────────────────────┘  │        │ └─────────────────────────────┘ │
│  ┌────────────────────┐  │        └─────────────────────────────────┘
│  │ Jun 12 · 3 ex · 9  │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Home | "History — coming soon." | List of past sessions (date, ex/set counts); empty-state line when none | `revalidatePath('/')` from the save action already keeps it fresh |
| History row | N/A | `<Link>` to `/workout/[id]` | Whole card is the link target |
| Detail page | Did not exist | Read-only view: exercises (ordered), sets (reps × weight) | 404 if not found / not owned. Edit & Delete are Phase 5 |

---

## ⚠️ Key Decisions (resolve ambiguity up front)
1. **Counts via one aggregate SQL query**, not N+1 or loading every child. `listWorkoutSummaries` left-joins exercises + sets and groups by workout, using drizzle's built-in `count`/`countDistinct` (which `mapWith(Number)`, so counts come back as numbers, not bigint strings). One round-trip for the whole list.
2. **Detail via a Drizzle relational query** (`db.query.workouts.findFirst({ with: { exercises: { with: { sets } } } })`) — the schema already defines the relations and `db` is constructed with `{ schema }`, so nested fetch is one query with correct ordering. Relational queries still expose `.toSQL()` for the user-scoping test.
3. **Both new queries are user-scoped at the source.** `listWorkoutSummaries` filters `workouts.user_id`; `getWorkoutDetail` filters `and(id, user_id)`. This keeps `src/db/workouts.ts` the single authorization boundary (same invariant as the existing `listWorkouts`/`getWorkout`).
4. **Not-found = not-owned.** `getWorkoutDetail` returns `undefined` both when the id doesn't exist and when it belongs to another user; the page calls `notFound()` in both cases — no information leak about existence.
5. **Pure formatting helpers** (`formatWorkoutDate`, `formatSet`) live in `src/lib/format.ts` and are unit-tested as plain functions (mirrors how the repo isolates pure logic in `workout-draft.ts`/`workout-input.ts`). Server-rendered, so date formatting uses the server's locale/timezone — acceptable for the POC.
6. **No change to the existing `listWorkouts`/`getWorkout`/`createWorkout`** — they stay untouched (no drive-by refactor), even though the new summary/detail functions supersede them for the UI.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/workouts.ts` | 1-36 | The authorization-boundary module to EXTEND; mirror the doc-comment + user-scoping style and the query-builder return shape |
| P0 | `src/db/schema.ts` | 1-66 | Columns + the `relations()` definitions that power the relational detail query (`workoutsRelations`, `workoutExercisesRelations`, `setsRelations`) |
| P0 | `src/db/index.ts` | 1-14 | `db = drizzle({ client, schema })` — `schema` is passed, so `db.query.*` relational queries work |
| P0 | `src/app/page.tsx` | 1-22 | The home Server Component to UPDATE: keep auth header + Start Workout button, replace the placeholder with the list |
| P0 | `src/lib/auth.ts` | 1-9 | `requireUserId()` returns the userId to scope queries with |
| P1 | `src/db/workouts.test.ts` | 1-25 | The `.toSQL()` user-scoping assertion idiom to extend for the two new queries |
| P1 | `src/app/workout/new/page.tsx` | 1-21 | Server-component shell conventions: `max-w-md p-6`, header with a `<Link buttonVariants ghost sm>` back/cancel |
| P1 | `src/components/ui/card.tsx` | 1-103 | `Card`/`CardHeader`/`CardTitle`/`CardContent` primitives for both list rows and detail |
| P1 | `src/lib/workout-input.ts` | 17-34 | `SetInput`/`ExerciseInput` shapes (the persisted columns the detail renders mirror these) |
| P2 | `src/app/workout/new/workout-logger.tsx` | 54-73 | Existing exercise-card markup (`name · category`, set rows) to stay visually consistent with |
| P2 | `.claude/PRPs/plans/completed/core-logging-loop.plan.md` | all | Phase 3 plan — how `revalidatePath('/')` and `saveWorkout` set up this phase |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Drizzle relational queries | `drizzle-orm/postgres-js` (`db.query.<table>.findFirst/findMany`) | `db.query.workouts.findFirst({ where, with: { exercises: { orderBy, with: { sets: { orderBy } } } } })` returns a nested object; works because `drizzle({ client, schema })` registers relations. Exposes `.toSQL()`. |
| Drizzle aggregates | `drizzle-orm` `count` / `countDistinct` | Built-ins apply `.mapWith(Number)`, so results are JS `number` (avoids postgres-js returning bigint as a string). Use them, not a hand-written `sql\`count(*)\``. |
| Next.js 16 dynamic params | App Router (`next` 16.2.9) | In a dynamic route, `params` is a **Promise** — type it `Promise<{ id: string }>` and `await` it. |
| `notFound()` | `next/navigation` | Call inside a Server Component to render the 404 boundary; throws, so code after it is unreachable. |

> No further external research needed — feature uses established internal patterns plus the verified Drizzle/Next APIs above.

---

## Patterns to Mirror

### REPOSITORY_USER_SCOPING (query builder, filtered by userId)
```ts
// SOURCE: src/db/workouts.ts:16-31
export function listWorkouts(userId: string) {
  return db.select().from(workouts)
    .where(eq(workouts.userId, userId))
    .orderBy(desc(workouts.startedAt))
}
export function getWorkout(userId: string, id: string) {
  return db.select().from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
    .limit(1)
}
```
→ `listWorkoutSummaries(userId)` filters `workouts.userId`; `getWorkoutDetail(userId, id)` filters `and(id, userId)`.

### TEST_TOSQL (user-scoping assertion without a DB)
```ts
// SOURCE: src/db/workouts.test.ts:8-18
const { sql, params } = listWorkouts(USER).toSQL()
expect(sql).toContain('"user_id"'); expect(params).toContain(USER)

const { sql, params } = getWorkout(USER, WORKOUT_ID).toSQL()
expect(params).toEqual(expect.arrayContaining([USER, WORKOUT_ID]))
```
→ Same idiom for `listWorkoutSummaries` and `getWorkoutDetail`.

### SERVER_COMPONENT_AUTH (gate, then read)
```ts
// SOURCE: src/app/page.tsx:7-9
export default async function HomePage() {
  await requireUserId(); // middleware also guards; this is defense-in-depth
```
→ Capture the id: `const userId = await requireUserId()`, then pass it to the query.

### SERVER_COMPONENT_SHELL (container + header + ghost link)
```tsx
// SOURCE: src/app/workout/new/page.tsx:10-20
<main className="mx-auto w-full max-w-md p-6">
  <header className="flex items-center justify-between">
    <h1 className="text-xl font-semibold">New Workout</h1>
    <Link href="/" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>Cancel</Link>
  </header>
  ...
</main>
```
→ The detail page uses the same shell with a "← Back" link to `/`.

### EXERCISE_CARD_MARKUP (visual consistency with the logger)
```tsx
// SOURCE: src/app/workout/new/workout-logger.tsx:55-73
<Card key={exercise.id}>
  <CardHeader>
    <CardTitle className="text-base">
      {exercise.name}
      <span className="font-normal text-muted-foreground"> · {exercise.category}</span>
    </CardTitle>
  </CardHeader>
  <CardContent className="space-y-2">
    <div className="flex items-center gap-2">
      <span className="w-10 text-sm text-muted-foreground">Set {i + 1}</span> ...
```
→ Detail re-uses this shape, read-only (no inputs/remove buttons). NB: the persisted exercise has no `category` column (it's not stored), so the detail header shows `name` only.

### PURE_HELPER_TESTABLE
```ts
// SOURCE: src/app/workout/new/workout-draft.ts:116-130 (toReps/toWeight) — pure, unit-tested
```
→ `formatWorkoutDate`/`formatSet` are pure and unit-tested in `src/lib/format.test.ts`.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/workouts.ts` | UPDATE | Add `listWorkoutSummaries(userId)` (aggregate) and `getWorkoutDetail(userId, id)` (relational), plus a `WorkoutSummary` type and a `WorkoutDetail` type |
| `src/db/workouts.test.ts` | UPDATE | Add `.toSQL()` user-scoping tests for both new queries |
| `src/lib/format.ts` | CREATE | Pure `formatWorkoutDate(date)` and `formatSet(reps, weight)` display helpers |
| `src/lib/format.test.ts` | CREATE | Unit tests for `formatSet` (all null/partial combos) + a light `formatWorkoutDate` assertion |
| `src/app/page.tsx` | UPDATE | Replace placeholder with the history list (links to `/workout/[id]`) + empty state |
| `src/app/workout/[id]/page.tsx` | CREATE | Server Component detail view; `notFound()` when missing/not-owned |

## NOT Building
- **Edit / delete** of a workout or its sets — Phase 5.
- **Pagination / infinite scroll** on history — POC lists all of the user's workouts (small N during dogfooding).
- **Progress charts / analytics / per-exercise history** — explicitly out of scope (PRD "NOT Building").
- **`completedAt`/duration display, set "completed" checkmarks** — not surfaced in the POC.
- **Storing/showing exercise category on the detail page** — category isn't a persisted column (`workout_exercises` has `wger_exercise_id`, `name`, `position` only); no live wger re-fetch in detail.
- **kg/lb toggle** — weight rendered raw in kg (PRD lean).
- **Client interactivity on these pages** — both are Server Components; no `'use client'`.

---

## Step-by-Step Tasks

### Task 1: Add history + detail queries (`src/db/workouts.ts` — UPDATE)
- **ACTION**: Add two user-scoped read functions and the result types to the data-access module.
- **IMPLEMENT**:
  ```ts
  import { and, asc, count, countDistinct, desc, eq } from 'drizzle-orm'
  // (extend the existing import on line 1)

  /** A history-list row: a workout plus aggregate counts of its exercises/sets. */
  export interface WorkoutSummary {
    id: string
    name: string | null
    startedAt: Date
    exerciseCount: number
    setCount: number
  }

  /** Lists a user's workouts (most recent first) with exercise/set counts, in one query. */
  export function listWorkoutSummaries(userId: string) {
    return db
      .select({
        id: workouts.id,
        name: workouts.name,
        startedAt: workouts.startedAt,
        exerciseCount: countDistinct(workoutExercises.id),
        setCount: count(sets.id),
      })
      .from(workouts)
      .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
      .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
      .where(eq(workouts.userId, userId))
      .groupBy(workouts.id)
      .orderBy(desc(workouts.startedAt))
  }

  /** Fetches a single workout with its exercises and sets, only if owned by the user. */
  export function getWorkoutDetail(userId: string, id: string) {
    return db.query.workouts.findFirst({
      where: and(eq(workouts.id, id), eq(workouts.userId, userId)),
      with: {
        exercises: {
          orderBy: (e) => [asc(e.position)],
          with: { sets: { orderBy: (s) => [asc(s.setNumber)] } },
        },
      },
    })
  }

  /** The full nested shape returned by getWorkoutDetail (workout + exercises + sets). */
  export type WorkoutDetail = NonNullable<Awaited<ReturnType<typeof getWorkoutDetail>>>
  ```
- **MIRROR**: REPOSITORY_USER_SCOPING (`src/db/workouts.ts:16-31`); the module doc-comment about the authorization boundary.
- **IMPORTS**: extend line 1 to `import { and, asc, count, countDistinct, desc, eq } from 'drizzle-orm'`; `workoutExercises, sets` are already imported on line 4.
- **GOTCHA**: Use the built-in `count`/`countDistinct` (they `mapWith(Number)`) so counts are JS numbers, not bigint strings. The double `leftJoin` fans out rows per (exercise, set) pair — `countDistinct(workoutExercises.id)` keeps the exercise count correct while `count(sets.id)` (counts non-null ids) gives total sets; a workout with no exercises/sets yields `0`/`0`, not a missing row, thanks to the left joins. `getWorkoutDetail` returns a `PromiseLike` (still has `.toSQL()`); `WorkoutDetail` via `Awaited<ReturnType<typeof getWorkoutDetail>>` resolves because TS hoists the function declaration. The `where` filters BOTH `id` and `user_id`, so another user's id resolves to `undefined`.
- **VALIDATE**: `npx tsc --noEmit`; covered by Task 2.

### Task 2: Query user-scoping tests (`src/db/workouts.test.ts` — UPDATE)
- **ACTION**: Extend the existing `.toSQL()` suite to prove the two new queries filter by user.
- **IMPLEMENT** (add to the existing `describe`, keep the current three tests intact):
  ```ts
  import {
    listWorkouts, getWorkout, createWorkout,
    listWorkoutSummaries, getWorkoutDetail,
  } from './workouts'

  it('scopes the history summary query to the user', () => {
    const { sql, params } = listWorkoutSummaries(USER).toSQL()
    expect(sql).toContain('"user_id"')
    expect(sql).toMatch(/count/i) // aggregate counts present
    expect(params).toContain(USER)
  })

  it('scopes the detail query to the user as well as the id', () => {
    const { sql, params } = getWorkoutDetail(USER, WORKOUT_ID).toSQL()
    expect(sql).toContain('"user_id"')
    expect(params).toEqual(expect.arrayContaining([USER, WORKOUT_ID]))
  })
  ```
- **MIRROR**: TEST_TOSQL (`src/db/workouts.test.ts:8-18`).
- **IMPORTS**: add the two new functions to the existing import line.
- **GOTCHA**: This is the unmocked `.toSQL()` file (no `vi.mock('./index')`) — `getWorkoutDetail(...).toSQL()` builds SQL lazily and never dials the socket (the dummy `DATABASE_URL` in `vitest.setup.ts` lets the client construct, same as the existing tests). Drizzle emits lowercase `count(...)`; match case-insensitively (`/count/i`).
- **VALIDATE**: `npx vitest run src/db/workouts.test.ts`.

### Task 3: Display helpers (`src/lib/format.ts` — CREATE)
- **ACTION**: Add pure formatting helpers for the workout date and a set's reps/weight.
- **IMPLEMENT**:
  ```ts
  /** Formats a workout's date for display, e.g. "Jun 14, 2026" (server locale). */
  export function formatWorkoutDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
  }

  /**
   * Formats a logged set's reps/weight for display. `null` means the field was
   * left blank when logging.
   *   (5, 100) → "5 × 100 kg"   (5, null) → "5 reps"
   *   (null, 100) → "100 kg"    (null, null) → "—"
   */
  export function formatSet(reps: number | null, weight: number | null): string {
    if (reps !== null && weight !== null) return `${reps} × ${weight} kg`
    if (reps !== null) return `${reps} reps`
    if (weight !== null) return `${weight} kg`
    return '—'
  }
  ```
- **MIRROR**: PURE_HELPER_TESTABLE (`src/app/workout/new/workout-draft.ts:116-130`).
- **IMPORTS**: none.
- **GOTCHA**: Keep these pure (no React/JSX) so they unit-test as functions and import cleanly into a Server Component. `weight` is `numeric(mode:'number')` in the schema, so it arrives as `number | null` (fractional plate weights like `2.5` render exactly).
- **VALIDATE**: `npx tsc --noEmit`; covered by Task 4.

### Task 4: Helper tests (`src/lib/format.test.ts` — CREATE)
- **ACTION**: Unit-test the formatters.
- **IMPLEMENT** (AAA, descriptive names): `formatSet` — `(5,100)→"5 × 100 kg"`, `(5,null)→"5 reps"`, `(null,100)→"100 kg"`, `(null,null)→"—"`, `(8,2.5)→"8 × 2.5 kg"`. `formatWorkoutDate` — `formatWorkoutDate(new Date('2026-06-14T12:00:00Z'))` returns a string containing `'2026'` (locale-tolerant).
- **MIRROR**: test structure in `src/app/workout/new/workout-draft.test.ts` / `src/lib/workout-input.test.ts`.
- **IMPORTS**: `vitest`; `formatWorkoutDate, formatSet` from `./format`.
- **GOTCHA**: Don't assert the exact date string (timezone/locale-dependent) — assert it contains the year. Use a midday-UTC time so the date can't roll to the prior day in negative-offset timezones.
- **VALIDATE**: `npx vitest run src/lib/format.test.ts`.

### Task 5: History list on home (`src/app/page.tsx` — UPDATE)
- **ACTION**: Replace the "History — coming soon." placeholder with the user's workout list; keep the auth header and Start Workout button.
- **IMPLEMENT**:
  - `const userId = await requireUserId()` (capture instead of discarding).
  - `const summaries = await listWorkoutSummaries(userId)`.
  - Below the Start Workout link: `<h2 className="mt-8 text-sm font-medium text-muted-foreground">History</h2>`.
  - If `summaries.length === 0`: `<p className="mt-2 text-sm text-muted-foreground">No workouts yet — start your first one.</p>`.
  - Else a `<ul className="mt-3 space-y-2">` of rows; each row a `<Link>` wrapping a `<Card size="sm">`:
    ```tsx
    <li key={w.id}>
      <Link href={`/workout/${w.id}`} className="block rounded-xl transition-colors hover:bg-muted/40">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-base">{w.name ?? 'Workout'}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {formatWorkoutDate(w.startedAt)} · {w.exerciseCount} exercise{w.exerciseCount === 1 ? '' : 's'} · {w.setCount} set{w.setCount === 1 ? '' : 's'}
          </CardContent>
        </Card>
      </Link>
    </li>
    ```
- **MIRROR**: SERVER_COMPONENT_AUTH; existing `buttonVariants()` Start Workout link; Card usage.
- **IMPORTS**: add `import { listWorkoutSummaries } from '@/db/workouts'`, `import { formatWorkoutDate } from '@/lib/format'`, `import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'`. Keep existing `Link`, `UserButton`, `requireUserId`, `buttonVariants`, `cn`.
- **GOTCHA**: `name` is nullable → fall back to `'Workout'`. `startedAt` is a `Date`. Stays a Server Component (no `'use client'`); importing `@/db/workouts` here is correct (server-side). The save action's `revalidatePath('/')` already invalidates this page, so a new workout appears without extra wiring. Use a stable `key={w.id}`.
- **VALIDATE**: `npm run build` (route `/` compiles); manual: a saved workout shows in the list.

### Task 6: Detail page (`src/app/workout/[id]/page.tsx` — CREATE)
- **ACTION**: Add the read-only session detail Server Component.
- **IMPLEMENT**:
  ```tsx
  import Link from 'next/link'
  import { notFound } from 'next/navigation'
  import { requireUserId } from '@/lib/auth'
  import { getWorkoutDetail } from '@/db/workouts'
  import { formatWorkoutDate, formatSet } from '@/lib/format'
  import { buttonVariants } from '@/components/ui/button'
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
  import { cn } from '@/lib/utils'

  export default async function WorkoutDetailPage({
    params,
  }: {
    params: Promise<{ id: string }>
  }) {
    const userId = await requireUserId()
    const { id } = await params
    const workout = await getWorkoutDetail(userId, id)
    if (!workout) notFound()

    return (
      <main className="mx-auto w-full max-w-md p-6">
        <header className="flex items-center justify-between">
          <Link href="/" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
            ← Back
          </Link>
          <h1 className="text-xl font-semibold">{workout.name ?? 'Workout'}</h1>
        </header>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatWorkoutDate(workout.startedAt)}
        </p>

        <div className="mt-6 space-y-4">
          {workout.exercises.map((exercise) => (
            <Card key={exercise.id}>
              <CardHeader>
                <CardTitle className="text-base">{exercise.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {exercise.sets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sets logged.</p>
                ) : (
                  exercise.sets.map((set, i) => (
                    <div key={set.id} className="flex items-center gap-3 text-sm">
                      <span className="w-12 text-muted-foreground">Set {i + 1}</span>
                      <span>{formatSet(set.reps, set.weight)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    )
  }
  ```
- **MIRROR**: SERVER_COMPONENT_SHELL (`src/app/workout/new/page.tsx`); EXERCISE_CARD_MARKUP (read-only).
- **IMPORTS**: as shown.
- **GOTCHA**: In Next 16, `params` is a **Promise** — type it and `await` it. `notFound()` throws, so nothing after it runs (no `else` needed). The persisted exercise has no `category` column, so the header is `name` only (unlike the logger's `name · category`). Keys use `exercise.id`/`set.id` (stable row UUIDs); the visible "Set N" uses the array index since `setNumber` ordering is already applied by the query. `requireUserId()` + the user-scoped query are the access control — a workout owned by someone else 404s.
- **VALIDATE**: `npm run build` lists `/workout/[id]`; manual: opening a saved workout shows its exercises/sets; visiting a random/foreign UUID 404s.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| summary query scoped to user | `listWorkoutSummaries(USER)` | SQL contains `"user_id"` + `count`; params include USER | no |
| detail query scoped to id+user | `getWorkoutDetail(USER, ID)` | SQL contains `"user_id"`; params include USER and ID | no |
| formatSet both | `(5, 100)` | `"5 × 100 kg"` | no |
| formatSet reps only | `(5, null)` | `"5 reps"` | yes |
| formatSet weight only | `(null, 100)` | `"100 kg"` | yes |
| formatSet neither | `(null, null)` | `"—"` | yes |
| formatSet fractional | `(8, 2.5)` | `"8 × 2.5 kg"` | yes |
| formatWorkoutDate | `new Date('2026-06-14T12:00:00Z')` | string containing `"2026"` | no |

### Edge Cases Checklist
- [x] Empty input (no workouts → home shows empty-state line)
- [x] Workout with an exercise but no sets (detail shows "No sets logged."; summary counts that exercise, 0 sets)
- [x] Blank reps/weight on a set (`formatSet` → "N reps" / "N kg" / "—")
- [x] Not-found id (detail → `notFound()`)
- [x] Permission denied / foreign workout (user-scoped query → `undefined` → `notFound()`; middleware + `requireUserId` gate the route)
- [x] Nullable workout name (falls back to "Workout")
- [ ] Pagination / very large history — out of scope for POC (note in Risks)
- [ ] Concurrent access — N/A (read-only)

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
EXPECT: All pass, including the two new `.toSQL()` query tests and the `format` tests.

### Build
```bash
npm run build
```
EXPECT: Build succeeds; route list includes `/` and `/workout/[id]`.

### Database Validation (manual — confirms list/detail match what was logged)
```bash
# Against DATABASE_URL_DIRECT (psql / Supabase SQL editor):
#   select id, name, started_at from workouts order by started_at desc;
#   select position, name from workout_exercises where workout_id = '<id>' order by position;
#   select set_number, reps, weight from sets
#     where workout_exercise_id in (select id from workout_exercises where workout_id = '<id>')
#     order by set_number;
```
EXPECT: Home list order/counts and detail rows match these rows exactly (round-trip integrity = 100%, per the PRD metric).

### Browser Validation (signed in)
```bash
npm run dev
# Save a workout (Phase 3 flow) → land on / → it appears under "History"
# Tap the row → /workout/[id] → exercises (in order) + sets (reps × weight) shown
# Manually visit /workout/<random-uuid> → 404
```
EXPECT: List and detail render the logged data; foreign/unknown ids 404.

### Manual Validation
- [ ] With no workouts, home shows "No workouts yet — start your first one."
- [ ] After saving, the workout appears in History with correct date and exercise/set counts.
- [ ] Tapping a history row opens its detail page.
- [ ] Detail shows exercises in logged order and each set as reps × weight (blanks render "reps"/"kg"/"—").
- [ ] An exercise with no sets shows "No sets logged."
- [ ] Visiting an unknown or another user's workout id returns 404.

---

## Acceptance Criteria
- [ ] Home (`/`) lists the signed-in user's past workouts with date + exercise/set counts, most recent first.
- [ ] Each row links to `/workout/[id]`; the detail page shows exercises (ordered) and sets (reps × weight).
- [ ] Both reads are user-scoped at the data-access layer; a foreign/unknown id 404s.
- [ ] Empty history shows a clear empty state.
- [ ] All validation commands pass (type-check, lint, tests, build).
- [ ] Matches the UX design (list → tap → detail).

## Completion Checklist
- [ ] Follows discovered patterns (user-scoped repo queries, `.toSQL()` tests, server-component auth + shell, Card markup, pure helpers).
- [ ] Error handling matches codebase style (`notFound()` for missing/not-owned; no info leak; no swallowed errors).
- [ ] Tests follow the repo idiom (AAA, top constants, `.toSQL()` assertions).
- [ ] No hardcoded values; no new runtime dependency.
- [ ] No mutation; queries built immutably.
- [ ] PRD Phase 4 marked in-progress + linked to this plan.
- [ ] Self-contained — implementable without further codebase searching.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Aggregate counts return bigint strings (postgres-js) instead of numbers | M | M | Use drizzle's built-in `count`/`countDistinct` (they `mapWith(Number)`); the `WorkoutSummary` type declares `number`. Verify in browser/DB check. |
| Relational query (`db.query.*`) misconfigured (relations not registered) | L | H | Schema already defines `workoutsRelations`/`workoutExercisesRelations`/`setsRelations` and `db` is built with `{ schema }`. The `.toSQL()` test exercises the builder; the browser check confirms nesting. Fallback: explicit joins + in-JS grouping (documented, not built). |
| Next 16 `params` typing (sync vs Promise) breaks the build | L | M | Type `params` as `Promise<{ id: string }>` and `await` it (Next 15/16 contract). Caught by `npm run build`. |
| Double left-join inflates the set count | L | M | `count(sets.id)` counts non-null set ids once per set row; `countDistinct(workoutExercises.id)` keeps exercises distinct. Confirm against the DB validation query. |
| Date formatting differs by server timezone | L | L | Acceptable for POC (server-rendered); tests assert the year only. Revisit with client-side/locale formatting later. |
| Large history with no pagination | L | L | Out of scope for POC (small N during dogfooding); note a future `limit`/pagination. |

## Notes
- **Why one aggregate query for the list:** avoids N+1 (a count query per workout) and avoids loading every set just to count them — one round-trip returns the whole history with counts.
- **Why a relational query for detail:** the schema's `relations()` make nested fetch + per-level ordering a single declarative query; `getWorkoutDetail` returns the exact nested tree the page renders, and `WorkoutDetail = Awaited<ReturnType<...>>` keeps the page's types in sync with the query automatically.
- **Authorization boundary stays in `src/db/workouts.ts`:** both new functions filter by `userId`, so Server Components never need to re-check ownership beyond calling the scoped query (then `notFound()` on `undefined`).
- **Phase 5 hand-off:** the detail page is the natural host for Edit/Delete controls; `getWorkoutDetail` already returns the full editable tree, and `revalidatePath('/')` + a future `revalidatePath('/workout/[id]')` will refresh both surfaces.
- **No new dependencies; no client components** — consistent with the repo's lean, server-first POC stance.
