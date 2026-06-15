# Plan: "Last time" inline (per-set ghost inputs)

## Summary

When an exercise in the draft has prior history, pre-fill each set's reps/weight
**input placeholders** ("ghost" text) with what the user did that set last time —
set 1's inputs show last time's set 1, set 2 shows set 2, and so on — converted
to the active weight unit. The ghost vanishes the moment the user types. Data is
fetched on demand via a read-only server action (exercises are added dynamically
in a client component). Pure read over existing tables — no schema change.

## User Story

As a lifter mid-workout, I want each set's inputs to hint what I did last time
for that set, so that I can match or beat it without leaving the logger or
remembering numbers.

## Problem → Solution

**Current**: The logger shows empty reps/weight inputs with only static column
headers ("Reps" / "Kg"). Recalling last session means backing out to history.
**Desired**: Each set input shows a greyed ghost of last time's value for that
set position. Typing replaces the ghost. No history → plain empty inputs. More
sets than last time → the extra sets stay blank. A missing field last time (null
reps/weight) → that one input stays blank.

## Metadata

- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/progressive-overload-essentials.prd.md`
- **PRD Phase**: Phase 2 — "Last time" inline
- **Estimated Files**: 8 (2 created, 6 updated)

---

## UX Design

### Before
```
┌ Squat · Legs                        🗑 ┐
│            REPS        KG               │
│   1      [     ]    [      ]       ✕    │
│   [ + Add set ]                         │
└─────────────────────────────────────────┘
```

### After (prior history: last time was 5×100, 5×100, 5×95)
```
┌ Squat · Legs                        🗑 ┐
│            REPS        KG               │
│   1      [ 5 ]      [ 100 ]        ✕    │  ← ghost (greyed) = last time set 1
│   2      [ 5 ]      [ 100 ]        ✕    │  ← set 2
│   3      [ 5 ]      [ 95  ]        ✕    │  ← set 3
│   4      [   ]      [     ]        ✕    │  ← no history for set 4 → blank
│   [ + Add set ]                         │
└─────────────────────────────────────────┘
(values shown are placeholders; typing replaces them)
```

### Edge states
```
First time (no history):   inputs render exactly as today — empty, no ghosts.
Last time had null weight: that input's ghost is omitted; reps ghost still shows.
Unit = lb:                 weight ghost converts (100 kg → "220.5").
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Set inputs (per set) | empty, static headers | empty inputs whose `placeholder` = last time's value for that set index | Placeholder is native ghost — disappears on input |
| Add exercise (picker) | section with empty sets | section appears, ghosts fill in once fetched | One server-action call per distinct `wgerExerciseId` |
| Edit existing workout | pre-filled real values | pre-filled values stay; empty sets get ghosts excluding the workout being edited | Real `value` always wins over `placeholder` |
| No prior history | empty | empty (no ghosts), no error | `getLastPerformance` returns `null` |
| More sets than last time | empty | extra sets blank (no ghost) | `last.sets[index]` is `undefined` |
| Unit toggle (kg↔lb) | n/a | weight ghosts re-render in new unit | Stored kg, converted at render |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/workouts.ts` | 1-65 | DATA_ACCESS_MODULE pattern; `listWorkoutSummaries` shows `select` + `innerJoin`/`leftJoin` + `orderBy`; `getWorkoutDetail` shows `and(eq…)` user-scoping. Mirror for `getLastPerformance`. |
| P0 | `src/db/schema.ts` | 13-46 | Column names for the join: `workouts(userId, startedAt)`, `workoutExercises(workoutId, wgerExerciseId)`, `sets(workoutExerciseId, setNumber, reps, weight)` |
| P0 | `src/app/workout/actions.ts` | 1-37 | SERVER_ACTION pattern: `'use server'`, `requireUserId()`, validate, call db, throw on bad input |
| P0 | `src/app/workout/new/workout-logger.tsx` | 120-175 | The exact set-row JSX (reps `<Input>`, weight `<Input>`) where `placeholder` is set; `unit` already threaded; `'use client'`; `setIndex` is the set position |
| P1 | `src/lib/format.ts` | 1-35 | `formatSet` + `kgToDisplay` usage; mirror for new `placeholderForSet` |
| P1 | `src/lib/units.ts` | 1-30 | `kgToDisplay(weightKg, unit)`, `WeightUnit` type — weight conversion for display |
| P1 | `src/db/preferences.test.ts` | 1-90 | Mocked-db chain pattern for `getLastPerformance` tests |
| P1 | `src/lib/format.test.ts` | 1-40 | Pure-util test style for `placeholderForSet` |
| P2 | `src/app/workout/new/exercise-picker.tsx` | 20-100 | `onAdd` fires `{ wgerExerciseId, name, category }` — the fetch trigger; effect+cleanup pattern |
| P2 | `src/app/workout/new/workout-draft.ts` | 22-49 | `DraftExercise`/`DraftSet` shapes; reducer is pure; sets are ordered |
| P2 | `src/app/workout/[id]/edit/page.tsx` | 11-41 | Edit mode passes `workoutId` to the logger → used to exclude the current workout |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Drizzle `and()` with undefined | drizzle-orm v0.45 | `and(a, b, undefined)` ignores `undefined` — conditionally add `ne(workouts.id, excludeWorkoutId)` inline |
| Drizzle `ne` | drizzle-orm | `ne(col, value)` → SQL `<>`; import alongside `and, asc, desc, eq` |
| HTML `placeholder` | MDN | An undefined/empty `placeholder` renders no ghost; a real `value` always takes visual precedence over `placeholder` |

No further external research needed — feature uses established internal patterns.

---

## Patterns to Mirror

### DATA_ACCESS_MODULE (select + join + order + limit, user-scoped)
```ts
// SOURCE: src/db/workouts.ts:34-49 (listWorkoutSummaries)
export function listWorkoutSummaries(userId: string) {
  return db
    .select({ id: workouts.id, name: workouts.name, startedAt: workouts.startedAt })
    .from(workouts)
    .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
    .where(eq(workouts.userId, userId))
    .orderBy(desc(workouts.startedAt))
}
// Every helper takes userId first; the module is the authorization boundary.
```

### SERVER_ACTION (validate unknown, call db)
```ts
// SOURCE: src/app/workout/actions.ts:16-22
export async function saveWorkoutAction(input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseWorkoutInput(input)
  const result = await saveWorkout(userId, parsed)
  revalidatePath('/')
  return result
}
// Read-only actions skip revalidatePath; still requireUserId + validate inputs.
```

### CONVERSION-AT-RENDER (stored kg → active unit)
```ts
// SOURCE: src/lib/format.ts:12-22 (formatSet, post unit-preference)
export function formatSet(reps, weightKg, unit: WeightUnit = 'kg'): string {
  const weight = weightKg !== null ? `${kgToDisplay(weightKg, unit)} ${unit}` : null
  ...
}
// All kg↔display math goes through kgToDisplay — never ad-hoc arithmetic in views.
```

### CURRENT SET-ROW JSX (where placeholders attach)
```tsx
// SOURCE: src/app/workout/new/workout-logger.tsx (set row; reps + weight inputs)
<Input type="number" inputMode="numeric" min={0}
  value={set.reps}
  onChange={(e) => dispatch({ type: 'UPDATE_SET', exerciseIndex, setIndex, field: 'reps', value: e.target.value })}
  aria-label={`Set ${setIndex + 1} reps`} className="flex-1 text-center tnum" />
<Input type="number" inputMode="decimal" min={0} step="0.5"
  value={set.weight}
  onChange={(e) => dispatch({ type: 'UPDATE_SET', exerciseIndex, setIndex, field: 'weight', value: e.target.value })}
  aria-label={`Set ${setIndex + 1} weight in ${unit}`} className="flex-1 text-center tnum" />
// Neither input has a placeholder today — that's exactly where the ghost goes.
```

### CLIENT_STATE_MAP + EFFECT FETCH (mirror ExercisePicker's effect+cleanup)
```ts
// SOURCE: src/app/workout/new/exercise-picker.tsx:29-46
useEffect(() => {
  const controller = new AbortController()
  fetch('/api/exercises?all=1', { signal: controller.signal }).then(/*…*/).catch(/*…*/)
  return () => controller.abort()
}, [])
// Effect owns async + cleanup; server-action version uses a `cancelled` flag.
```

### TEST_STRUCTURE (db module, mocked client chain)
```ts
// SOURCE: src/db/preferences.test.ts:14-44
function makeSelectBuilder() {
  const builder = { from: () => builder, where: () => builder, limit: () => Promise.resolve(rows) }
  return builder
}
vi.mock('./index', () => ({ db: { select: () => makeSelectBuilder() } }))
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/workouts.ts` | UPDATE | Add `getLastPerformance(userId, wgerExerciseId, excludeWorkoutId?)` + `LastPerformance` type; import `ne` |
| `src/db/workouts.test.ts` (or `last-performance.test.ts`) | CREATE | Mocked-db tests: most-recent pick, exclude, no-history null |
| `src/app/workout/actions.ts` | UPDATE | Add read-only `getLastPerformanceAction` (validate id, optional exclude) |
| `src/lib/format.ts` | UPDATE | Add pure `placeholderForSet(last, index, unit)` → `{ reps?, weight? }` |
| `src/lib/format.test.ts` | UPDATE | Cases for `placeholderForSet` (null/out-of-range/null-fields/lb) |
| `src/app/workout/new/workout-logger.tsx` | UPDATE | Client state map + effect fetch; set each set row's reps/weight `placeholder` from prior performance |
| `drizzle/*.sql` | CREATE (optional) | Only if adding the `workoutExercises.wgerExerciseId` index (see Risks) |

## NOT Building

- **A separate summary line** under the header — the ghost lives in the inputs themselves now.
- **"Last completed" semantics** — `completedAt` is never set in this codebase, so "last" = most recent by `startedAt`. Revisit if a complete-workout action lands.
- **Trend/delta indicators** ("+5 kg vs last time") — adjacent to Phase 4 (PRs/1RM).
- **"Last time you did N sets" hint** when the user has fewer sets than history — out of scope; extra prior sets are simply not surfaced.
- **Caching/prefetch of all exercises' history** — fetch on demand per added exercise.

---

## Step-by-Step Tasks

### Task 1: `getLastPerformance` data access (`src/db/workouts.ts`)
- **ACTION**: Add a user-scoped helper returning the most recent prior performance of an exercise (sets in set order).
- **IMPLEMENT**:
  ```ts
  /** A prior performance of an exercise: when it was done and its sets (weights in kg, set order). */
  export interface LastPerformance {
    performedAt: Date
    sets: { reps: number | null; weight: number | null }[]
  }

  /**
   * Most recent prior performance of `wgerExerciseId` for the user, by workout
   * startedAt. `excludeWorkoutId` omits the workout currently being edited so it
   * doesn't report itself. Returns null when there's no history.
   */
  export async function getLastPerformance(
    userId: string,
    wgerExerciseId: number,
    excludeWorkoutId?: string,
  ): Promise<LastPerformance | null> {
    const [recent] = await db
      .select({ exerciseId: workoutExercises.id, performedAt: workouts.startedAt })
      .from(workoutExercises)
      .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
      .where(
        and(
          eq(workouts.userId, userId),
          eq(workoutExercises.wgerExerciseId, wgerExerciseId),
          excludeWorkoutId ? ne(workouts.id, excludeWorkoutId) : undefined,
        ),
      )
      .orderBy(desc(workouts.startedAt))
      .limit(1)

    if (!recent) return null

    const setRows = await db
      .select({ reps: sets.reps, weight: sets.weight })
      .from(sets)
      .where(eq(sets.workoutExerciseId, recent.exerciseId))
      .orderBy(asc(sets.setNumber))

    return { performedAt: recent.performedAt, sets: setRows }
  }
  ```
- **MIRROR**: DATA_ACCESS_MODULE (`listWorkoutSummaries`/`getWorkoutDetail`) — userId first, `and(eq…)` scoping, `orderBy(asc(setNumber))` for stable set order.
- **IMPORTS**: extend the top import to include `ne`: `import { and, asc, count, countDistinct, desc, eq, ne } from 'drizzle-orm'`.
- **GOTCHA**: `and(...)` drops `undefined` operands → conditional exclude is safe. `sets.weight` is `numeric(mode:'number')` → `number | null` in kg; do NOT convert here. Set order matters — ghosts map by index, so `orderBy(asc(sets.setNumber))` is required, not optional.
- **VALIDATE**: `npx tsc --noEmit`; tests in Task 2.

### Task 2: Data-access tests
- **ACTION**: Test most-recent selection, exclude, no-history with the mocked-db chain.
- **IMPLEMENT** (mock `./index`; the two `select` chains resolve `[recent]`/`[]` then set rows):
  - history exists → `{ performedAt, sets }` in set order
  - no match → first query `[]` → returns `null`, second query not run
  - exclude → 2-workout fixture, exclude the latest → returns the older
- **MIRROR**: TEST_STRUCTURE (`preferences.test.ts`). Track `select` call count to return `recentRows` then `setRows`; reset in `beforeEach`.
- **IMPORTS**: `import { describe, it, expect, vi, beforeEach } from 'vitest'`.
- **VALIDATE**: `npm test -- workouts` (or `last-performance`).

### Task 3: `placeholderForSet` helper (`src/lib/format.ts`)
- **ACTION**: Add a pure function mapping prior performance + set index → ghost placeholder strings (active unit). This is where ALL the edge handling lives.
- **IMPLEMENT**:
  ```ts
  /**
   * Ghost-input placeholders for set position `index`, from prior performance.
   * Returns {} when there's no history, no prior set at that index (more sets
   * than last time), or the field was blank last time — so the caller can spread
   * the result onto the inputs and unset fields simply render no ghost.
   */
  export function placeholderForSet(
    last: { sets: { reps: number | null; weight: number | null }[] } | null,
    index: number,
    unit: WeightUnit = 'kg',
  ): { reps?: string; weight?: string } {
    const prior = last?.sets[index]
    if (!prior) return {}
    return {
      reps: prior.reps !== null ? String(prior.reps) : undefined,
      weight: prior.weight !== null ? String(kgToDisplay(prior.weight, unit)) : undefined,
    }
  }
  ```
- **MIRROR**: CONVERSION-AT-RENDER (`formatSet`) — `kgToDisplay(weightKg, unit)`, default `'kg'`.
- **IMPORTS**: reuse `import { kgToDisplay, type WeightUnit } from './units'` already at the top of `format.ts`.
- **GOTCHA**: `last?.sets[index]` returns `undefined` for both "no history" (null `last`) and "more sets than data" (index past the array) — one branch handles both elegantly. Return `undefined` (not `''`) per field so `placeholder={value}` omits the attribute entirely.
- **VALIDATE**: `npm test -- format`.

### Task 4: Extend `format.test.ts`
- **ACTION**: Add `placeholderForSet` cases.
- **IMPLEMENT**:
  - history, index 0: `placeholderForSet({sets:[{reps:5,weight:100}]}, 0)` → `{ reps:'5', weight:'100' }`
  - lb: same, `'lb'` → `{ reps:'5', weight:'220.5' }`
  - no history: `placeholderForSet(null, 0)` → `{}`
  - more sets than data: `placeholderForSet({sets:[{reps:5,weight:100}]}, 1)` → `{}`
  - null field last time: `placeholderForSet({sets:[{reps:5,weight:null}]}, 0)` → `{ reps:'5', weight: undefined }`
- **MIRROR**: existing `describe` blocks in `format.test.ts`.
- **VALIDATE**: `npm test -- format` → all pass.

### Task 5: `getLastPerformanceAction` server action (`src/app/workout/actions.ts`)
- **ACTION**: Add a read-only action the client calls per exercise.
- **IMPLEMENT**:
  ```ts
  import { getLastPerformance, type LastPerformance } from '@/db/workouts'

  /**
   * The signed-in user's most recent prior performance of an exercise, or null.
   * Read-only — no revalidate. `excludeWorkoutId` omits the workout being edited.
   */
  export async function getLastPerformanceAction(
    wgerExerciseId: unknown,
    excludeWorkoutId?: unknown,
  ): Promise<LastPerformance | null> {
    const userId = await requireUserId()
    if (!Number.isInteger(wgerExerciseId)) throw new Error('invalid exercise id')
    const exclude = typeof excludeWorkoutId === 'string' ? excludeWorkoutId : undefined
    return getLastPerformance(userId, wgerExerciseId as number, exclude)
  }
  ```
- **MIRROR**: SERVER_ACTION (`saveWorkoutAction`) — `requireUserId` + validate untrusted args; omit `revalidatePath`.
- **IMPORTS**: add `getLastPerformance, type LastPerformance` from `@/db/workouts`.
- **GOTCHA**: validate `wgerExerciseId` is an integer (comes from client state). `performedAt` Date serializes fine over the boundary (we don't even render it here).
- **VALIDATE**: `npx tsc --noEmit`.

### Task 6: Ghost placeholders in the logger (`src/app/workout/new/workout-logger.tsx`)
- **ACTION**: Fetch per distinct exercise; set each set row's reps/weight `placeholder` from prior performance.
- **IMPLEMENT**:
  - Imports: extend the react import with `useEffect`; add `import { getLastPerformanceAction } from '@/app/workout/actions'`, `import { placeholderForSet } from '@/lib/format'`, `import type { LastPerformance } from '@/db/workouts'`.
  - State: `const [lastByExercise, setLastByExercise] = useState<Record<number, LastPerformance | null>>({})`
  - Effect (fetch any not-yet-fetched exercise id; reserve keys to avoid duplicate calls):
    ```ts
    useEffect(() => {
      const ids = Array.from(new Set(draft.exercises.map((e) => e.wgerExerciseId)))
      const missing = ids.filter((id) => !(id in lastByExercise))
      if (missing.length === 0) return
      let cancelled = false
      setLastByExercise((prev) => {
        const next = { ...prev }
        for (const id of missing) if (!(id in next)) next[id] = null // reserve
        return next
      })
      ;(async () => {
        for (const id of missing) {
          try {
            const result = await getLastPerformanceAction(id, workoutId)
            if (!cancelled) setLastByExercise((prev) => ({ ...prev, [id]: result }))
          } catch {
            /* leave null — non-critical, no ghosts shown */
          }
        }
      })()
      return () => { cancelled = true }
    }, [draft.exercises, lastByExercise, workoutId])
    ```
  - In the set row, compute and apply placeholders (using `setIndex` as the position):
    ```tsx
    const ghost = placeholderForSet(lastByExercise[exercise.wgerExerciseId] ?? null, setIndex, unit)
    // reps <Input>:  add  placeholder={ghost.reps}
    // weight <Input>: add placeholder={ghost.weight}
    ```
    Optionally enrich a11y: `aria-label={`Set ${setIndex + 1} reps${ghost.reps ? `, last time ${ghost.reps}` : ''}`}` (and similarly for weight). Optional — keep if it reads cleanly.
- **MIRROR**: CLIENT_STATE_MAP + EFFECT FETCH (ExercisePicker effect+cleanup); CURRENT SET-ROW JSX (attach `placeholder` to the existing inputs — no structural change).
- **IMPORTS**: as above.
- **GOTCHA**: a real `value` (typed input or edit-mode pre-fill) always visually overrides `placeholder`, so ghosts only show on empty inputs — exactly the desired behavior, no extra conditional needed. Reserving keys as `null` before fetch prevents the `lastByExercise`-dependent effect from refetching in flight. Pass `workoutId` (undefined in new mode) as the exclude.
- **VALIDATE**: `npx tsc --noEmit`; manual check in Task 7.

### Task 7: Manual + full verification
- **ACTION**: Run the full suite and the manual smoke test.
- **VALIDATE**: see Validation Commands.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| getLastPerformance history | rows present | `{performedAt, sets:[…]}` in set order | no |
| getLastPerformance none | first query `[]` | `null` (second query not run) | empty |
| getLastPerformance exclude | 2 workouts, exclude latest | the older one | exclusion |
| placeholderForSet hit | `({sets:[{5,100}]},0)` | `{reps:'5',weight:'100'}` | no |
| placeholderForSet lb | `(…,0,'lb')` | `{reps:'5',weight:'220.5'}` | conversion |
| placeholderForSet no history | `(null,0)` | `{}` | first time |
| placeholderForSet out of range | `({sets:[…1…]},1)` | `{}` | more inputs than data |
| placeholderForSet null field | `({sets:[{5,null}]},0)` | `{reps:'5',weight:undefined}` | partial data |
| getLastPerformanceAction bad id | `'abc'` | throws `invalid exercise id` | invalid input |

### Edge Cases Checklist
- [x] First time / no history (`null` → `{}` → empty inputs, no ghosts)
- [x] More sets than last time (index past array → `{}` → blank)
- [x] Null reps/weight last time (that field's ghost omitted)
- [x] Invalid types (`getLastPerformanceAction` rejects non-integer id)
- [x] Edit mode self-reference (`excludeWorkoutId` omits the current workout)
- [x] Real value present (typed/edit pre-fill) overrides ghost — native behavior
- [x] Unit switch (weight ghosts re-render via `kgToDisplay`)
- [ ] Network failure (action throws → caught → null → no ghosts; acceptable, non-critical)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit --pretty false
```
EXPECT: Zero type errors

### Unit Tests (affected)
```bash
npm test -- workouts format
```
EXPECT: All pass

### Full Test Suite
```bash
npm test
```
EXPECT: No regressions (existing 100 tests + new tests green)

### Lint
```bash
npm run lint
```
EXPECT: No errors

### Build
```bash
npm run build
```
EXPECT: Compiles, zero errors

### Manual Validation
- [ ] Log Squat (5×100, 5×100), save
- [ ] Start a new workout, add Squat → set 1 & 2 inputs show greyed `5` / `100`; type in set 1 → ghost replaced
- [ ] Add a 3rd set → it's blank (no history for set 3)
- [ ] Toggle to lb → weight ghosts read `220.5`
- [ ] Add an exercise never logged → all inputs blank, no error
- [ ] Edit the original Squat workout → real values show; ghosts (if any empty sets) exclude this workout

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing (query, placeholder helper, action guard)
- [ ] No type errors / no lint errors
- [ ] Ghost placeholders show per set position in the active unit and update on toggle
- [ ] First-time and more-inputs-than-data cases render blank inputs (no ghosts, no error)
- [ ] Typed/edit values always override ghosts
- [ ] Edit mode excludes the workout being edited

## Completion Checklist
- [ ] Code follows discovered patterns (data-access module, server action, conversion-at-render)
- [ ] Error handling matches codebase style (throw at boundaries; client catch leaves it silent)
- [ ] No `console.log`
- [ ] Tests follow vitest AAA style
- [ ] No ad-hoc kg↔lb math (only `kgToDisplay`)
- [ ] No unnecessary scope additions (no summary line, no trends)
- [ ] Self-contained — implemented without further codebase searching

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ghost mistaken for a real entered value | M | Low | Native placeholder styling is visibly greyed/muted; clears on focus-type; matches common "last time" UX |
| Effect refetch loop / duplicate requests | M | Low | Reserve keys as `null` synchronously before fetching; effect targets only missing ids |
| Unindexed `workoutExercises.wgerExerciseId` slows query as data grows | L | Low | POC scale tiny; optionally add `index('we_wger_exercise_id_idx')` + migration |
| Set reordering/removal misaligns ghost-to-set | L | Low | Ghosts map by current `setIndex`; on removal the indices shift but ghosts simply re-map to the new positions — acceptable, ghosts are hints not data |

## Notes
- **Resolves PRD open question** ("last = most recent containing the exercise, or most recent *completed*?"): `completedAt` is never written anywhere, so "most recent by `startedAt`" is the only workable definition today. Documented; revisit if a complete-workout action is added.
- **Why placeholders, not values**: ghosts must never become saved data. Using the native `placeholder` attribute means an untouched set saves `null` (not last time's number) — the draft/`draftToInput` path is unchanged. The user must type to log a value.
- **Why a server action, not SSR props**: exercises are chosen interactively in a `'use client'` logger, so a just-added exercise's history isn't known at render — fetch on demand. Mirrors `saveWorkoutAction`'s boundary.
- **Unit consistency**: the logger already receives `unit`; weight ghosts reuse it via `placeholderForSet`, staying consistent with the inputs' column header and the detail page.
