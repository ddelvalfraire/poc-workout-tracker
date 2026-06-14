# Plan: Core Logging Loop (Phase 3)

## Summary
Build the core value loop: a signed-in user taps **Start Workout**, adds exercises from the Phase 2 wger proxy, logs sets (reps × weight), and **Saves** — persisting a `workouts` row plus nested `workout_exercises` and `sets`, all scoped to the Clerk `userId`, in a single transaction. Reads stay in Server Components; the write is a Server Action over a transactional, user-scoped data-access function.

## User Story
As a signed-in lifter at the gym,
I want to start a workout, add exercises, and log my sets,
So that my training is captured and saved for later review.

## Problem → Solution
The app can authenticate and fetch exercises but cannot record a workout (home page is a placeholder). → A `/workout/new` screen builds a draft session client-side and saves it via a Server Action that writes the workout and its nested exercises/sets atomically, scoped to the user.

## Metadata
- **Complexity**: Large
- **Source PRD**: `.claude/PRPs/prds/workout-tracker-pwa.prd.md`
- **PRD Phase**: Phase 3 — Core logging loop
- **Estimated Files**: 13 (10 create, 3 update)

> **Reviewability note (per repo rules: ≤300 lines/PR):** This phase is large. It is structured as two cohesive groups that can ship as **two commits/PRs**:
> - **3a — data + validation + action** (Tasks 1–5, fully unit-tested, no UI)
> - **3b — UI** (Tasks 6–13)
> Implement in that order; 3a has no UI dependency and 3b consumes it. A single combined commit is acceptable for the POC, but the split keeps each diff reviewable.

---

## UX Design

### Before
```
┌─────────────────────────────────────┐
│ Workout Tracker            (Clerk ●) │
│                                      │
│ Start Workout and History land in    │
│ the next phases.                     │
└─────────────────────────────────────┘
```

### After
```
Home (/)                          New Workout (/workout/new)
┌──────────────────────────┐      ┌─────────────────────────────────┐
│ Workout Tracker     (●)  │      │ ← New Workout            [Save]  │
│                          │      │ ┌─────────────────────────────┐ │
│  ┌────────────────────┐  │ tap  │ │ 🔍 Search exercises…        │ │
│  │   + Start Workout  │──┼────► │ │  Bench Press · Chest  [add] │ │
│  └────────────────────┘  │      │ └─────────────────────────────┘ │
│                          │      │ Bench Press            (Chest)  │
│  History — next phase    │      │   set 1  [reps] [kg]      [x]   │
└──────────────────────────┘      │   set 2  [reps] [kg]      [x]   │
                                  │          [+ add set]            │
                                  └─────────────────────────────────┘
                                     Save → writes to Supabase → /
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Home | Placeholder text | "Start Workout" button → `/workout/new` | History stays deferred (Phase 4) |
| New workout | Did not exist | Add exercises, log sets, Save | Online-only; draft is in-memory (no autosave) |
| Save | N/A | Server Action persists nested rows, redirects home | `revalidatePath('/')` so Phase 4 history is fresh |

---

## ⚠️ Key Decisions (resolve ambiguity up front)
1. **Server Action, not route handler** for the write (PRD says "Save via Server Action").
2. **Validation is hand-rolled** (`parseWorkoutInput(input: unknown)`), mirroring the `wger.ts` guard pattern added in Phase 2 — **no Zod** (not installed; consistent with the codebase's no-new-dep stance). Documented as the upgrade path.
3. **Atomic write via `db.transaction`** — workout + exercises + sets in one transaction so a partial save can't happen. Works on the Supabase transaction pooler (one connection held for BEGIN/COMMIT; `prepare:false` already set in `src/db/index.ts`).
4. **Client draft state via a pure reducer** (`workoutDraftReducer`) so the interaction logic is unit-testable without a DOM.
5. **After save**: the action returns `{ id }`; the client navigates to `/` via `useRouter().push('/')` inside `useTransition` (clean pending state + error handling). No server-side `redirect()` inside the action.
6. **`sets.completed`** stays at its DB default (`false`) — not surfaced in the POC UI.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/workouts.ts` | 1-36 | The authorization-boundary repo module to EXTEND with `saveWorkout`; mirror its doc-comment + user-scoping invariant |
| P0 | `src/db/schema.ts` | 1-66 | Exact columns/types for `workouts`, `workout_exercises`, `sets` (and the cascade FKs) that the insert must populate |
| P0 | `src/db/index.ts` | 1-14 | `db` export + the `prepare:false` pooler note relevant to `db.transaction` |
| P0 | `src/lib/wger.ts` | 60-110 | The `unknown`→validated guard pattern (`parseListResponse`/`mapExercise`) to mirror for `parseWorkoutInput` |
| P0 | `src/lib/auth.ts` | 1-9 | `requireUserId()` — used by the new server component and the Server Action |
| P1 | `src/app/page.tsx` | 1-18 | Server-component auth + layout to extend with the Start Workout button |
| P1 | `src/components/ui/button.tsx` | 1-58 | The cva + `@base-ui/react` wrap pattern to mirror for `Input` and to reuse for buttons |
| P1 | `src/app/api/exercises/route.ts` | all | The contract the picker calls: `GET /api/exercises?search=&limit=` → `Exercise[]` |
| P1 | `src/db/workouts.test.ts` | 1-25 | `.toSQL()` assertion idiom (used for the simple repo fns) |
| P1 | `src/lib/wger.test.ts` | 1-60 | `vi` mock idiom (used for `saveWorkout` tx mock + reducer/validation tests) |
| P2 | `src/components/ui/card.tsx` | 1-103 | Card primitives available for layout |
| P2 | `src/app/layout.tsx` | 1-37 | `ClerkProvider`, fonts, `max-w` container conventions |
| P2 | `components.json` / `tsconfig.json` | all | base-nova style; `@/* → src/*`; `@/hooks → src/hooks` |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| `@base-ui/react/input` | `node_modules/@base-ui/react/input` | Exports `Input`; `Input.Props` extends native `<input>` props (type, value, onChange, inputMode) — wrap like `Button` |
| Drizzle transactions (postgres-js) | `drizzle-orm/postgres-js/session.d.ts:49` | `db.transaction<T>(async (tx) => {...})`; `tx` exposes the same `insert/select` builders |
| Drizzle insert + returning | `src/db/workouts.ts:34` | `.insert(t).values(v).returning({ id: t.id })` returns rows; destructure `const [row] = await …` |
| Next.js Server Actions | App Router | `'use server'` module; importable into client components; pair with `revalidatePath` + client `useTransition` |

> No further external research needed — feature uses established internal patterns plus verified library APIs above.

---

## Patterns to Mirror

### REPOSITORY_USER_SCOPING
```ts
// SOURCE: src/db/workouts.ts:14-35
/** Creates a workout owned by the given user. */
export function createWorkout(userId: string, name?: string) {
  return db.insert(workouts).values({ userId, name }).returning()
}
```
→ `saveWorkout(userId, input)` stamps `userId` on the `workouts` row; children reference that workout, so the user-scoping invariant holds for the whole tree.

### VALIDATION_GUARD (unknown → validated, throw on bad shape)
```ts
// SOURCE: src/lib/wger.ts:64-77
function parseListResponse(data: unknown): { next: string | null; results: unknown[] } {
  if (!data || typeof data !== 'object') throw new Error('wger response was not a JSON object')
  const obj = data as Record<string, unknown>
  if (!Array.isArray(obj.results)) throw new Error('wger response was missing a results array')
  return { next: obj.next as string | null, results: obj.results }
}
```
→ `parseWorkoutInput(input: unknown): WorkoutInput` validates every field and throws on malformed input.

### UI_PRIMITIVE_WRAP (cva + @base-ui + cn)
```ts
// SOURCE: src/components/ui/button.tsx:1-4,43-56
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cn } from "@/lib/utils"
function Button({ className, variant = "default", size = "default", ...props }) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
```
→ `Input` wraps `@base-ui/react/input`'s `Input` with `cn` and the same token classes (`border-input`, `focus-visible:ring-ring/50`, `aria-invalid:*`).

### SERVER_COMPONENT_AUTH
```ts
// SOURCE: src/app/page.tsx:1-6
import { requireUserId } from "@/lib/auth";
export default async function HomePage() {
  await requireUserId(); // middleware also guards; this is defense-in-depth
  ...
}
```
→ `/workout/new/page.tsx` does the same before rendering the client logger.

### CLIENT_FETCH_CONTRACT
```ts
// SOURCE: src/app/api/exercises/route.ts — GET /api/exercises?search=&limit= → Exercise[]
// Exercise = { id: number; name: string; category: string; equipment?: string[] }
```
→ `ExercisePicker` fetches this, maps `{ id → wgerExerciseId, name, category }` into the draft.

### TEST_TOSQL (simple repo fns)
```ts
// SOURCE: src/db/workouts.test.ts:8-12
const { sql, params } = listWorkouts(USER).toSQL()
expect(sql).toContain('"user_id"'); expect(params).toContain(USER)
```

### TEST_VI_MOCK (validation, reducer, tx orchestration)
```ts
// SOURCE: src/lib/wger.test.ts:46-51 — vi mocks + AAA + top constants
beforeEach(() => { vi.restoreAllMocks() })
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/workout-input.ts` | CREATE | Shared `WorkoutInput`/`ExerciseInput`/`SetInput` types + `parseWorkoutInput` guard |
| `src/lib/workout-input.test.ts` | CREATE | Unit tests for validation (valid, missing/empty exercises, bad set values, optional name) |
| `src/db/workouts.ts` | UPDATE | Add `saveWorkout(userId, input)` transactional insert |
| `src/db/workouts.test.ts` | UPDATE | Add `saveWorkout` orchestration test (mocked tx: user-scoping, positions, set numbers, linkage) |
| `src/app/workout/actions.ts` | CREATE | `'use server'` `saveWorkoutAction(input)` → auth + validate + persist + revalidate |
| `src/components/ui/input.tsx` | CREATE | base-nova `Input` wrapping `@base-ui/react/input` |
| `src/hooks/use-debounce.ts` | CREATE | `useDebounce` for picker search input |
| `src/app/workout/new/workout-draft.ts` | CREATE | Pure `workoutDraftReducer` + draft types + `draftToInput` mapper |
| `src/app/workout/new/workout-draft.test.ts` | CREATE | Unit tests for reducer transitions + `draftToInput` coercion |
| `src/app/workout/new/exercise-picker.tsx` | CREATE | `'use client'` debounced search → `/api/exercises` → add to draft |
| `src/app/workout/new/workout-logger.tsx` | CREATE | `'use client'` main UI: draft reducer, set rows, Save via action |
| `src/app/workout/new/page.tsx` | CREATE | Server component: `requireUserId()` then render `<WorkoutLogger>` |
| `src/app/page.tsx` | UPDATE | Replace placeholder with "Start Workout" button → `/workout/new` |

## NOT Building
- **History list / session detail** — Phase 4.
- **Edit / delete** — Phase 5.
- **Draft persistence / autosave / offline** — in-memory only; navigating away discards (PRD: online-only POC).
- **`sets.completed` toggle, RPE, rest timers, supersets, kg/lb toggle** — out of scope (store weight raw in kg).
- **Exercise images, category/equipment filters in the picker UI** — name + category only; `equipment` ignored by the draft.
- **Zod** — hand-rolled validation; revisit when a validation lib lands.
- **Reordering exercises/sets (drag-drop)** — append-only for the POC; `position`/`set_number` are assignment order.
- **Optimistic UI** — simple pending state via `useTransition`.

---

## Step-by-Step Tasks

### Group 3a — Data, validation, action (server, testable)

### Task 1: Shared input types + validation guard (`src/lib/workout-input.ts`)
- **ACTION**: Create the shared contract between the client, the action, and the DB layer, plus a strict parser.
- **IMPLEMENT**:
  ```ts
  export interface SetInput { reps: number | null; weight: number | null }
  export interface ExerciseInput { wgerExerciseId: number; name: string; sets: SetInput[] }
  export interface WorkoutInput { name?: string; exercises: ExerciseInput[] }

  const MAX_NAME = 200
  // parseWorkoutInput(input: unknown): WorkoutInput
  //  - input must be an object with a non-empty `exercises` array
  //  - name: optional; if present must be string, trimmed, ≤ MAX_NAME (empty → omitted)
  //  - each exercise: wgerExerciseId is a finite integer; name non-empty string (trim, ≤ MAX_NAME); sets is an array
  //  - each set: reps is null or a non-negative integer; weight is null or a finite number ≥ 0
  //  - throws new Error('…') with a clear message on any violation; returns a fresh, normalized object
  ```
  Validate defensively field-by-field (mirror `wger.ts`), building a NEW normalized object (immutability). Reject `exercises.length === 0` ("a workout needs at least one exercise").
- **MIRROR**: VALIDATION_GUARD (`src/lib/wger.ts:64-110`).
- **IMPORTS**: none.
- **GOTCHA**: Use `Number.isInteger` for ids/reps and `Number.isFinite` for weight; coerce nothing silently — reject wrong types. Trim strings; treat empty trimmed name as "omit name", not error. Do not mutate `input`.
- **VALIDATE**: `npx tsc --noEmit`; covered by Task 2.

### Task 2: Validation tests (`src/lib/workout-input.test.ts`)
- **ACTION**: Unit-test `parseWorkoutInput`.
- **IMPLEMENT** (AAA, top constants): accepts a minimal valid workout (one exercise, one set); accepts `name`; omits blank/whitespace `name`; accepts `reps:null`/`weight:null`; **throws** on: non-object, missing/empty `exercises`, exercise missing `wgerExerciseId`, non-integer id, empty exercise name, negative reps, non-finite weight, set not an object.
- **MIRROR**: TEST_VI_MOCK structure (`src/lib/wger.test.ts`).
- **IMPORTS**: `vitest`; `parseWorkoutInput` and types from `./workout-input`.
- **GOTCHA**: assert thrown messages with `expect(() => …).toThrow(/exercise/i)` etc.; assert the returned object is normalized (trimmed, no extra keys).
- **VALIDATE**: `npx vitest run src/lib/workout-input.test.ts`.

### Task 3: Transactional save (`src/db/workouts.ts` — UPDATE)
- **ACTION**: Add `saveWorkout(userId, input)` that inserts the workout and its nested rows atomically.
- **IMPLEMENT**:
  ```ts
  import { workouts, workoutExercises, sets } from './schema'
  import type { WorkoutInput } from '@/lib/workout-input'

  /** Persists a full workout (exercises + sets) for the user, atomically. */
  export async function saveWorkout(userId: string, input: WorkoutInput): Promise<{ id: string }> {
    return db.transaction(async (tx) => {
      const [workout] = await tx
        .insert(workouts)
        .values({ userId, name: input.name })
        .returning({ id: workouts.id })

      for (const [position, exercise] of input.exercises.entries()) {
        const [we] = await tx
          .insert(workoutExercises)
          .values({ workoutId: workout.id, wgerExerciseId: exercise.wgerExerciseId, name: exercise.name, position })
          .returning({ id: workoutExercises.id })

        if (exercise.sets.length > 0) {
          await tx
            .insert(sets)
            .values(
              exercise.sets.map((s, i) => ({
                workoutExerciseId: we.id,
                setNumber: i + 1,
                reps: s.reps,
                weight: s.weight,
              })),
            )
            .returning({ id: sets.id })
        }
      }

      return { id: workout.id }
    })
  }
  ```
- **MIRROR**: REPOSITORY_USER_SCOPING (`src/db/workouts.ts:33-35`).
- **IMPORTS**: extend existing imports with `workoutExercises, sets`; add `import type { WorkoutInput } from '@/lib/workout-input'`.
- **GOTCHA**: `position` is the loop index (0-based); `setNumber` is 1-based. `weight` column is `numeric(mode:'number')` → pass a JS number or null. The transaction runs on the Supabase **transaction pooler** — supported (single connection per checkout); `prepare:false` is already set. Do NOT add a manual `where userId` to children — they inherit ownership through `workoutId`. The `.returning({ id: sets.id })` on the sets insert keeps every insert awaited uniformly (also simplifies the Task 4 mock).
- **VALIDATE**: `npx tsc --noEmit`; covered by Task 4.

### Task 4: Save orchestration test (`src/db/workouts.test.ts` — UPDATE)
- **ACTION**: Add a `saveWorkout` test that proves user-scoping, ordering, and linkage without a real DB.
- **IMPLEMENT**: Mock `./index` so `db.transaction(cb)` invokes `cb(tx)` with a recording stub:
  ```ts
  // tx.insert(table).values(v).returning() records v and yields deterministic ids by call order.
  // Sequence: 1st returning → [{id:'w1'}], 2nd → [{id:'e1'}], 3rd → [{id:'s1'}], ...
  ```
  Then for input `{ name:'Leg Day', exercises:[{ wgerExerciseId:73, name:'Squat', sets:[{reps:5,weight:100},{reps:5,weight:100}] }] }` assert the recorded `values` in order:
  - workout: `{ userId: USER, name: 'Leg Day' }`
  - exercise: `{ workoutId: 'w1', wgerExerciseId: 73, name: 'Squat', position: 0 }`
  - sets: array length 2, each `workoutExerciseId: 'e1'`, `setNumber` 1 then 2, reps/weight passthrough.
  - and `saveWorkout(...)` resolves to `{ id: 'w1' }`.
- **MIRROR**: TEST_VI_MOCK (`src/lib/wger.test.ts`).
- **IMPORTS**: `vitest` (`vi`, `describe`, `it`, `expect`, `beforeEach`).
- **GOTCHA**: the stub's `insert().values().returning()` must be chainable; `.returning()` returns a Promise resolving to id rows by a module-scoped counter; reset counter + records in `beforeEach`. Keep the existing `.toSQL()` tests for `listWorkouts/getWorkout/createWorkout` intact (the mock must not break them — put the `saveWorkout` test in its own file-level `vi.mock('./index', …)` or structure the mock so the query-builder fns still produce `.toSQL()`; simplest is a SEPARATE test file `src/db/save-workout.test.ts` that mocks `./index`, leaving `workouts.test.ts` unmocked). **Deviation note:** prefer a new `src/db/save-workout.test.ts` to avoid mock bleed into the `.toSQL()` tests.
- **VALIDATE**: `npx vitest run src/db/save-workout.test.ts`.

### Task 5: Server Action (`src/app/workout/actions.ts`)
- **ACTION**: Create the `'use server'` action that ties auth + validation + persistence together.
- **IMPLEMENT**:
  ```ts
  'use server'
  import { revalidatePath } from 'next/cache'
  import { requireUserId } from '@/lib/auth'
  import { parseWorkoutInput } from '@/lib/workout-input'
  import { saveWorkout } from '@/db/workouts'

  /** Validates and persists a workout for the signed-in user. Returns the new id. */
  export async function saveWorkoutAction(input: unknown): Promise<{ id: string }> {
    const userId = await requireUserId()
    const parsed = parseWorkoutInput(input)
    const result = await saveWorkout(userId, parsed)
    revalidatePath('/')
    return result
  }
  ```
- **MIRROR**: SERVER_COMPONENT_AUTH (`requireUserId`); VALIDATION_GUARD usage.
- **IMPORTS**: as shown.
- **GOTCHA**: `parseWorkoutInput` throwing surfaces to the client as a rejected action — the client must `try/catch`. Validation happens **server-side** here, not only in the browser. `requireUserId()` redirects unauthenticated callers (defense-in-depth atop middleware).
- **VALIDATE**: `npx tsc --noEmit`; exercised manually + browser validation.

### Group 3b — UI

### Task 6: `Input` component (`src/components/ui/input.tsx`)
- **ACTION**: Add a base-nova `Input` wrapping the Base UI primitive.
- **IMPLEMENT**:
  ```tsx
  import { Input as InputPrimitive } from "@base-ui/react/input"
  import { cn } from "@/lib/utils"

  function Input({ className, ...props }: InputPrimitive.Props) {
    return (
      <InputPrimitive
        data-slot="input"
        className={cn(
          "flex h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
          className,
        )}
        {...props}
      />
    )
  }
  export { Input }
  ```
- **MIRROR**: UI_PRIMITIVE_WRAP (`src/components/ui/button.tsx`).
- **IMPORTS**: as shown.
- **GOTCHA**: tokens must match the design system (`border-input`, `ring-ring/50`, `aria-invalid:*`) — copied from Button. No `'use client'` needed (presentational wrapper used inside client components).
- **VALIDATE**: `npx tsc --noEmit`; renders in the logger.

### Task 7: `useDebounce` hook (`src/hooks/use-debounce.ts`)
- **ACTION**: Add a generic debounce hook for the picker.
- **IMPLEMENT**:
  ```ts
  import { useEffect, useState } from 'react'
  export function useDebounce<T>(value: T, delay = 250): T {
    const [debounced, setDebounced] = useState(value)
    useEffect(() => {
      const id = setTimeout(() => setDebounced(value), delay)
      return () => clearTimeout(id)
    }, [value, delay])
    return debounced
  }
  ```
- **MIRROR**: rules/typescript/patterns.md `useDebounce`.
- **IMPORTS**: `react`.
- **GOTCHA**: `@/hooks` resolves to `src/hooks` via the `@/*` alias. Client-only by usage; no directive needed in the hook file.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 8: Draft reducer + mapper (`src/app/workout/new/workout-draft.ts`)
- **ACTION**: Pure client-state logic, separated for testability.
- **IMPLEMENT**:
  ```ts
  import type { WorkoutInput } from '@/lib/workout-input'

  export interface DraftSet { reps: string; weight: string }            // strings (controlled inputs)
  export interface DraftExercise { wgerExerciseId: number; name: string; category: string; sets: DraftSet[] }
  export interface WorkoutDraft { exercises: DraftExercise[] }

  export type DraftAction =
    | { type: 'ADD_EXERCISE'; exercise: { wgerExerciseId: number; name: string; category: string } }
    | { type: 'REMOVE_EXERCISE'; index: number }
    | { type: 'ADD_SET'; exerciseIndex: number }
    | { type: 'UPDATE_SET'; exerciseIndex: number; setIndex: number; field: 'reps' | 'weight'; value: string }
    | { type: 'REMOVE_SET'; exerciseIndex: number; setIndex: number }

  export const emptyDraft: WorkoutDraft = { exercises: [] }
  export function workoutDraftReducer(state: WorkoutDraft, action: DraftAction): WorkoutDraft { /* immutable updates */ }

  /** Maps the string-based draft to the API contract; '' → null, numeric strings → numbers. */
  export function draftToInput(draft: WorkoutDraft, name?: string): WorkoutInput { /* … */ }
  ```
  - `ADD_EXERCISE` appends an exercise seeded with one empty set (`{reps:'',weight:''}`) for friction-free logging.
  - All updates return NEW arrays/objects (no mutation).
  - `draftToInput`: `reps` → `parseInt(s,10)` or `null` if blank/NaN; `weight` → `parseFloat(s)` or `null`; build `{ name: name?.trim() || undefined, exercises: [...] }`.
- **MIRROR**: immutable-update rule (spread); type-only import of `WorkoutInput`.
- **IMPORTS**: type from `@/lib/workout-input`.
- **GOTCHA**: Keep this module free of React/JSX so it unit-tests as pure functions. Server re-validates, so `draftToInput` can be lenient.
- **VALIDATE**: `npx tsc --noEmit`; covered by Task 9.

### Task 9: Draft tests (`src/app/workout/new/workout-draft.test.ts`)
- **ACTION**: Unit-test the reducer + mapper.
- **IMPLEMENT**: ADD_EXERCISE appends with one seeded set; ADD_SET appends an empty set to the right exercise; UPDATE_SET changes only the targeted field and leaves siblings untouched (assert `next !== prev` and `prev` unchanged); REMOVE_SET / REMOVE_EXERCISE; `draftToInput` maps `''→null`, `'5'→5`, `'2.5'→2.5`, blank name → `undefined`.
- **MIRROR**: TEST structure (AAA).
- **IMPORTS**: `vitest`; functions/types from `./workout-draft`.
- **GOTCHA**: assert immutability by referential check.
- **VALIDATE**: `npx vitest run src/app/workout/new/workout-draft.test.ts`.

### Task 10: Exercise picker (`src/app/workout/new/exercise-picker.tsx`)
- **ACTION**: Client component: search wger proxy, list results, add to draft.
- **IMPLEMENT**:
  - `'use client'`. Props: `onAdd(exercise: { wgerExerciseId: number; name: string; category: string }): void`.
  - Local `query` state bound to `<Input>`; `const debounced = useDebounce(query)`.
  - `useEffect` on `debounced`: if `debounced.trim().length < 2` clear results; else `fetch('/api/exercises?search=' + encodeURIComponent(debounced) + '&limit=20', { signal })`, set results; ignore stale/`AbortError`; on non-ok set an error message.
  - Render result rows (`name` + `category`) each with an **add** `<Button size="sm">` calling `onAdd({ wgerExerciseId: r.id, name: r.name, category: r.category })`.
  - Show lightweight loading / empty / error text.
- **MIRROR**: CLIENT_FETCH_CONTRACT; Button usage.
- **IMPORTS**: `react` (`useEffect, useState`), `useDebounce` from `@/hooks/use-debounce`, `Button`, `Input`. Type the fetch result inline as `{ id:number; name:string; category:string }[]` (`equipment` ignored).
- **GOTCHA**: `/api/exercises` is auth-gated — same-origin `fetch` carries the Clerk session cookie, so it works for the signed-in user. Debounce + `AbortController` prevents floods/races; require ≥2 chars.
- **VALIDATE**: `npx tsc --noEmit`; manual search in browser.

### Task 11: Workout logger (`src/app/workout/new/workout-logger.tsx`)
- **ACTION**: Client component orchestrating draft, set rows, picker, and Save.
- **IMPLEMENT**:
  - `'use client'`. `const [draft, dispatch] = useReducer(workoutDraftReducer, emptyDraft)`; `const [name, setName] = useState('')`; `const [isPending, startTransition] = useTransition()`; `const [error, setError] = useState<string | null>(null)`; `const router = useRouter()`.
  - Optional workout name `<Input>` at top.
  - `<ExercisePicker onAdd={(ex) => dispatch({ type:'ADD_EXERCISE', exercise: ex })} />`.
  - For each `draft.exercises`: a `<Card>` with name + category, a **remove exercise** button, set rows (`reps` + `weight` `<Input type="number" inputMode="decimal">` wired to `UPDATE_SET`), a **remove set** button, and **+ add set**.
  - Save button (disabled when `draft.exercises.length === 0` or `isPending`): `startTransition(async () => { try { setError(null); await saveWorkoutAction(draftToInput(draft, name)); router.push('/') } catch { setError('Could not save workout. Please try again.') } })`.
  - Render `error` text when set.
- **MIRROR**: VALIDATION_GUARD consumer; Card/Button/Input usage.
- **IMPORTS**: `react` (`useReducer, useState, useTransition`), `useRouter` from `next/navigation`, `saveWorkoutAction` from `@/app/workout/actions`, draft module from `./workout-draft`, `ExercisePicker` from `./exercise-picker`, UI components.
- **GOTCHA**: importing a `'use server'` action into a client component is supported. Keep reps/weight inputs controlled by the draft STRINGS (never store numbers in the draft). Index keys are acceptable for the POC (whole list re-renders).
- **VALIDATE**: `npx tsc --noEmit`; end-to-end in browser.

### Task 12: New-workout route (`src/app/workout/new/page.tsx`)
- **ACTION**: Server component gate + shell.
- **IMPLEMENT**:
  ```tsx
  import { requireUserId } from '@/lib/auth'
  import { WorkoutLogger } from './workout-logger'
  export default async function NewWorkoutPage() {
    await requireUserId()
    return (
      <main className="mx-auto w-full max-w-md p-6">
        <h1 className="text-xl font-semibold">New Workout</h1>
        <WorkoutLogger />
      </main>
    )
  }
  ```
- **MIRROR**: SERVER_COMPONENT_AUTH (`src/app/page.tsx`); `max-w-md` container.
- **IMPORTS**: as shown.
- **GOTCHA**: export name of `WorkoutLogger` must match the import (use a named export in Task 11). Page is a server component; the logger is the client boundary.
- **VALIDATE**: `npm run build` lists `/workout/new`.

### Task 13: Home "Start Workout" entry (`src/app/page.tsx` — UPDATE)
- **ACTION**: Replace the placeholder paragraph with a Start Workout button linking to `/workout/new`.
- **IMPLEMENT**: keep the header/auth; render `<Link className={cn(buttonVariants(), 'mt-8 w-full')} href="/workout/new">+ Start Workout</Link>` and a small "History — coming soon" note.
- **MIRROR**: `buttonVariants` usage; existing page layout.
- **IMPORTS**: `Link` from `next/link`; `buttonVariants` from `@/components/ui/button`; `cn` from `@/lib/utils`.
- **GOTCHA**: don’t break the existing `requireUserId()` + `<UserButton/>` header. Using `buttonVariants()` on `<Link>` avoids base-ui `render`-prop typing friction.
- **VALIDATE**: `npm run build`; clicking navigates to `/workout/new`.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected | Edge? |
|---|---|---|---|
| validate minimal workout | 1 exercise, 1 set | normalized `WorkoutInput` | no |
| validate omits blank name | `name:'  '` | `name` undefined | yes |
| validate rejects empty exercises | `{exercises:[]}` | throws /at least one exercise/ | yes |
| validate rejects bad id | `wgerExerciseId:'x'` | throws | yes |
| validate rejects negative reps | `reps:-1` | throws | yes |
| validate accepts null reps/weight | `reps:null,weight:null` | ok | yes |
| saveWorkout user-scoping | USER + 1 ex/2 sets | workout stamped USER; ex.position 0; sets.setNumber 1,2; linkage ids | no |
| saveWorkout return | as above | `{ id:'w1' }` | no |
| reducer ADD_EXERCISE | empty draft | 1 exercise w/ 1 seeded set | no |
| reducer UPDATE_SET | nested draft | only target field changes; prev unmutated | yes |
| reducer REMOVE_SET/EXERCISE | nested draft | row removed, others intact | no |
| draftToInput coercion | `'','5','2.5'` | `null,5,2.5` | yes |

### Edge Cases Checklist
- [x] Empty input (no exercises → Save disabled client-side AND rejected server-side)
- [x] Invalid types (validation throws; action rejects → client shows error)
- [x] Blank reps/weight (→ null)
- [x] Network failure on picker (fetch non-ok/abort → error text, no crash)
- [x] Network/DB failure on save (action rejects → caught, error shown)
- [x] Permission denied (middleware + `requireUserId` in page & action)
- [ ] Concurrent access — N/A (single user draft; transaction is atomic)
- [ ] Max size — not enforced for POC (note in Risks)

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
EXPECT: No errors (no `console.log`; `console.error` allowed in catch paths).

### Unit Tests
```bash
npm test
```
EXPECT: All pass, including the new validation, reducer, and `saveWorkout` tests.

### Build
```bash
npm run build
```
EXPECT: Build succeeds; routes include `/workout/new` and `/api/exercises`.

### Database Validation (manual, after a real save)
```bash
# In Supabase SQL editor or psql against DATABASE_URL_DIRECT:
#   select * from workouts order by created_at desc limit 1;
#   select * from workout_exercises where workout_id = '<id>';
#   select * from sets where workout_exercise_id in (...);
```
EXPECT: One workout with the correct `user_id`, its exercises (position 0..n), and sets (set_number 1..n) with the logged reps/weight.

### Browser Validation (signed in)
```bash
npm run dev
# / → Start Workout → search "bench" → add → enter reps/weight → + add set → Save → lands on /
```
EXPECT: Save succeeds and the row tree exists in Supabase (DB validation above).

### Manual Validation
- [ ] Start Workout navigates to `/workout/new`.
- [ ] Searching ≥2 chars lists real wger exercises; Add appends an exercise with one set row.
- [ ] reps/weight inputs are editable; +add set / remove set / remove exercise work.
- [ ] Save with zero exercises is disabled; Save persists and redirects to `/`.
- [ ] Saved workout appears in Supabase with correct `user_id` and nested rows.

---

## Acceptance Criteria
- [ ] A signed-in user can start a workout, add wger exercises, log sets, and Save.
- [ ] Save writes `workouts` (+ `workout_exercises` + `sets`) atomically, scoped to `userId`.
- [ ] Server-side validation rejects malformed input independent of the client.
- [ ] All validation commands pass (type-check, lint, tests, build).
- [ ] Matches the UX design (Start → add → log → Save → home).

## Completion Checklist
- [ ] Follows discovered patterns (user-scoped repo, validation guard, base-ui wrap, server-component auth).
- [ ] Error handling matches codebase style (throw + catch; user-friendly message; no leaks).
- [ ] Tests follow the repo idiom (AAA, top constants, vi mocks / `.toSQL()`).
- [ ] No hardcoded secrets; no new runtime dependency.
- [ ] No mutation in reducer/validation (new objects throughout).
- [ ] PRD Phase 3 marked in-progress + linked.
- [ ] Self-contained — implementable without further codebase searching.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Drizzle transaction misbehaves on Supabase transaction pooler | L | H | Transaction mode supports BEGIN/COMMIT per checked-out connection; `prepare:false` already set. Verify with the manual DB check; if issues, fall back to sequential inserts with cleanup-on-failure (documented, not built). |
| `saveWorkout` tx mock is brittle | M | L | Test asserts recorded `values` + resolved id only (behavioral), not drizzle internals; reset state in `beforeEach`; isolate in `save-workout.test.ts`. |
| base-ui `Input` prop typing friction | L | L | `Input.Props` extends native input — straightforward; Home button uses `buttonVariants()` on `<Link>` to avoid `render`-prop typing. |
| Picker request races / floods | M | M | `useDebounce` + `AbortController`; min 2 chars; ignore stale/abort. |
| Large PR exceeds review budget | M | M | Ship 3a then 3b as separate commits/PRs (see top note). |
| Unbounded workout size (many sets) | L | L | Out of scope for POC; note a future cap in validation. |

## Notes
- **Why a pure reducer + pure validation + pure mapper:** it makes the interactive logic testable without a DOM or DB, matching how `wger.ts`/`workouts.ts` are tested in this repo, and keeps the React components thin.
- **Contract sharing:** `WorkoutInput` lives in `src/lib/workout-input.ts` and is imported by the client mapper (`draftToInput`), the action, and `saveWorkout` — one source of truth for the save shape.
- **Phase 4 hand-off:** `revalidatePath('/')` and the persisted rows set up the history list directly; `saveWorkout` returning `{ id }` enables a future redirect to a detail page.
- **Server boundary:** `src/lib/workout-input.ts` and `src/db/workouts.ts` are server-side; never import `@/db/*` into a client component — the client only calls `saveWorkoutAction` and `fetch('/api/exercises')`.
