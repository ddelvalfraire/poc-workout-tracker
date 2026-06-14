# Plan: Unit Preference (kg/lb)

## Summary

Add a per-user weight-unit preference (kg or lb). Weights stay stored canonically in kg; a single conversion utility converts to the user's chosen unit at every display point and converts entered values back to kg at save time. A small toggle on the home header lets the user switch units, persisted in a new `user_preferences` table and read server-side so SSR renders the correct unit with no client flicker.

## User Story

As a lifter who trains in pounds, I want to set my weight unit to lb, so that every weight I see and enter is in the unit I think in — without the app silently changing my stored data.

## Problem → Solution

**Current**: Every weight is hardcoded to kg — the detail page prints `"5 × 100 kg"` via `formatSet`, the logger inputs say `placeholder="kg"`, and the draft string IS kg. lb users are excluded.
**Desired**: A user-level `unit` ('kg' | 'lb'); kg stored canonically; conversion centralized in one util; display + input respect the unit; a toggle persists the choice.

## Metadata

- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/progressive-overload-essentials.prd.md`
- **PRD Phase**: Phase 1 — Unit preference (kg/lb)
- **Estimated Files**: 13 (5 created, 8 updated)

---

## UX Design

### Before
```
Home header:           [ Workout Tracker ]            [UserButton]

Detail page set row:   Set 1   5 × 100 kg
Logger set row:        Set 1  [ reps ] [ kg ]  ✕      (weight always kg)
```

### After
```
Home header:           [ Workout Tracker ]   [ kg | lb ] [UserButton]
                                              └ toggle (kg active = filled)

Detail page set row:   Set 1   5 × 220.5 lb           (when unit = lb)
Logger set row:        Set 1  [ reps ] [ lb ]  ✕      (placeholder follows unit)
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Home header | h1 + UserButton | h1 + UnitToggle + UserButton | Toggle persists via server action, then `router.refresh()` |
| Detail set display | `formatSet(reps, weight)` → kg | `formatSet(reps, weightKg, unit)` → converted | Stored kg converted at render |
| Logger weight input | `placeholder="kg"`, value is kg | `placeholder={unit}`, value is in display unit | Converted back to kg on save |
| Edit pre-fill | `detailToDraft(workout)` (kg strings) | `detailToDraft(workout, unit)` (display-unit strings) | kg→display on load |
| Save mapping | `draftToInput(draft, name)` (kg) | `draftToInput(draft, name, unit)` (display→kg) | display→kg on save |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/schema.ts` | 1-46 | Table definition style (`pgTable`, column helpers, comments) to mirror for `user_preferences` |
| P0 | `src/lib/format.ts` | 1-17 | `formatSet` is the central display point — hardcodes `kg`; must become unit-aware |
| P0 | `src/app/workout/new/workout-draft.ts` | 117-169 | `toWeight`, `draftToInput`, `detailToDraft` — the input↔kg boundary mappers to make unit-aware |
| P0 | `src/db/workouts.ts` | 1-22 | Data-access module pattern (user-scoped helpers, doc comment) to mirror in `preferences.ts` |
| P1 | `src/app/workout/actions.ts` | 1-22 | Server Action pattern: `'use server'`, `requireUserId()`, validate, `revalidatePath` |
| P1 | `src/app/workout/new/workout-logger.tsx` | 90-127 | Weight `<Input>` (placeholder/aria) to make unit-aware; client component prop wiring |
| P1 | `src/db/save-workout.test.ts` | 1-101 | The `vi.mock('./index', ...)` DB-mock pattern for `preferences.test.ts` |
| P1 | `src/lib/format.test.ts` | 1-32 | vitest unit-test style (`describe/it/expect`, AAA) for `units.test.ts` |
| P2 | `src/app/page.tsx` | 10-23 | Home header where the toggle mounts; how pages read userId + data |
| P2 | `src/components/ui/button.tsx` | 22-41 | `Button` variants/sizes available for the toggle (`size="sm"`, `variant` default/ghost) |
| P2 | `src/lib/auth.ts` | 1-9 | `requireUserId()` used by the new server action |
| P2 | `drizzle/0000_majestic_manta.sql` | 1-29 | Generated-migration format; confirm `db:generate` output shape |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Drizzle upsert | drizzle-orm v0.45 `.onConflictDoUpdate` | `db.insert(t).values(v).onConflictDoUpdate({ target: t.userId, set: {...} })` — Postgres `ON CONFLICT`; `target` is the PK column |
| kg↔lb factor | NIST | `1 lb = 0.45359237 kg` exactly; use as the single constant |

No further external research needed — feature uses established internal patterns.

---

## Patterns to Mirror

### NAMING_CONVENTION
```ts
// SOURCE: src/db/schema.ts:13-24
export const workouts = pgTable(
  'workouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // Clerk user id, e.g. "user_2abc..."
    ...
  },
)
// snake_case column names, camelCase TS keys, trailing comment for non-obvious fields.
```

### TYPE_UNION (prefer string-literal unions over enums)
```ts
// SOURCE: convention from rules + src/app/workout/new/workout-draft.ts:36-47 (discriminated unions)
// New: export type WeightUnit = 'kg' | 'lb'
```

### DATA_ACCESS_MODULE
```ts
// SOURCE: src/db/workouts.ts:1-22
import { and, asc, count, countDistinct, desc, eq } from 'drizzle-orm'
import { db } from './index'
import { workouts, workoutExercises, sets } from './schema'

/** Lists a user's workouts, most recent first. */
export function listWorkouts(userId: string) {
  return db.select().from(workouts).where(eq(workouts.userId, userId)).orderBy(desc(workouts.startedAt))
}
// Every helper takes userId first; module is the authorization boundary.
```

### SERVER_ACTION
```ts
// SOURCE: src/app/workout/actions.ts:1-22
'use server'
import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'

export async function saveWorkoutAction(input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseWorkoutInput(input) // validate unknown at the boundary
  const result = await saveWorkout(userId, parsed)
  revalidatePath('/')
  return result
}
// Actions take `unknown`, validate, then call the db layer. Throw on bad input.
```

### CLIENT_ACTION_WIRING (useTransition + router)
```ts
// SOURCE: src/app/workout/new/workout-logger.tsx:34-54
const [isPending, startTransition] = useTransition()
const router = useRouter()
function handleSave() {
  startTransition(async () => {
    try { await saveWorkoutAction(...); router.push('/') }
    catch { setError('Could not save workout. Please try again.') }
  })
}
```

### BOUNDARY_MAPPER (string draft ↔ numeric contract)
```ts
// SOURCE: src/app/workout/new/workout-draft.ts:125-147
function toWeight(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = parseFloat(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : null
}
export function draftToInput(draft: WorkoutDraft, name?: string): WorkoutInput { ... }
// Lenient mapping; server re-validates via parseWorkoutInput.
```

### TEST_STRUCTURE (pure util)
```ts
// SOURCE: src/lib/format.test.ts:1-24
import { describe, it, expect } from 'vitest'
import { formatSet } from './format'
describe('formatSet', () => {
  it('formats reps and weight together', () => {
    expect(formatSet(5, 100)).toBe('5 × 100 kg')
  })
})
```

### TEST_STRUCTURE (db module, mocked client)
```ts
// SOURCE: src/db/save-workout.test.ts:28-41
vi.mock('./index', () => ({
  db: { transaction: (cb) => cb(makeTx()) },
}))
import { saveWorkout } from './workouts'
beforeEach(() => { records.length = 0; idCounter = 0 })
// Mock '@/db/index' (the `db` export) and assert what the builder received.
```

### VALIDATION_GUARD (type predicate)
```ts
// SOURCE: src/lib/workout-input.ts:44-47 (defensive narrowing style)
function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error(message)
  return value as Record<string, unknown>
}
// New: isWeightUnit(value): value is WeightUnit  — narrow untrusted action input.
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/units.ts` | CREATE | `WeightUnit` type, constants, kg↔display conversion + `isWeightUnit` guard |
| `src/lib/units.test.ts` | CREATE | Unit tests for conversion + round-trip + guard |
| `src/db/preferences.ts` | CREATE | User-scoped `getWeightUnit` / `setWeightUnit` data access (upsert) |
| `src/db/preferences.test.ts` | CREATE | Mocked-db tests for default fallback + upsert |
| `src/components/unit-toggle.tsx` | CREATE | Client toggle calling the server action + `router.refresh()` |
| `src/db/schema.ts` | UPDATE | Add `userPreferences` table |
| `src/app/actions.ts` | CREATE | App-level `setWeightUnitAction` ('use server') |
| `src/lib/format.ts` | UPDATE | `formatSet` takes `unit` (default `'kg'`), converts via units util |
| `src/lib/format.test.ts` | UPDATE | Add lb cases (kg-default cases stay green) |
| `src/app/workout/new/workout-draft.ts` | UPDATE | `draftToInput` + `detailToDraft` take `unit` (default `'kg'`), convert |
| `src/app/workout/new/workout-draft.test.ts` | UPDATE | Add lb-conversion cases (kg-default cases stay green) |
| `src/app/workout/new/workout-logger.tsx` | UPDATE | Accept `unit` prop; placeholder/aria follow unit; pass unit to mappers |
| `src/app/workout/new/page.tsx` | UPDATE | Read unit, pass to `<WorkoutLogger unit=… />` |
| `src/app/workout/[id]/edit/page.tsx` | UPDATE | Read unit, pass to `detailToDraft` and `<WorkoutLogger unit=… />` |
| `src/app/workout/[id]/page.tsx` | UPDATE | Read unit, pass to `formatSet` |
| `src/app/page.tsx` | UPDATE | Read unit, mount `<UnitToggle unit=… />` in header |
| `drizzle/*.sql` | CREATE (generated) | New migration from `db:generate` for `user_preferences` |

## NOT Building

- **Per-exercise unit override** — one unit per user in v1.
- **Plate-increment snapping** on entered weights — store the exact converted kg (rounded to column precision); snapping is a flagged refinement.
- **Re-storing historical data per unit / mixed-unit columns** — canonical kg only.
- **A dedicated settings page** — the toggle lives in the home header for the POC.
- **"Last time", Repeat, PRs/1RM** — later PRD phases.

---

## Step-by-Step Tasks

### Task 1: Conversion utility (`src/lib/units.ts`)
- **ACTION**: Create the single source of truth for the unit type and kg↔display conversion.
- **IMPLEMENT**:
  ```ts
  export type WeightUnit = 'kg' | 'lb'
  export const WEIGHT_UNITS = ['kg', 'lb'] as const satisfies readonly WeightUnit[]
  export const DEFAULT_WEIGHT_UNIT: WeightUnit = 'kg'

  // 1 lb = 0.45359237 kg (exact, NIST).
  const KG_PER_LB = 0.45359237

  /** Narrows untrusted input (server-action payloads, DB text) to a WeightUnit. */
  export function isWeightUnit(value: unknown): value is WeightUnit {
    return value === 'kg' || value === 'lb'
  }

  /** Rounds a display weight to 1 decimal place (e.g. 220.46→220.5, 100→100). */
  function roundForDisplay(value: number): number {
    return Math.round(value * 10) / 10
  }

  /** Converts a stored kg weight into the display unit, rounded for display. */
  export function kgToDisplay(weightKg: number, unit: WeightUnit): number {
    return roundForDisplay(unit === 'lb' ? weightKg / KG_PER_LB : weightKg)
  }

  /** Converts a value entered in the display unit back to kg, at column precision (2dp). */
  export function displayToKg(value: number, unit: WeightUnit): number {
    const kg = unit === 'lb' ? value * KG_PER_LB : value
    return Math.round(kg * 100) / 100 // sets.weight is numeric(6,2)
  }
  ```
- **MIRROR**: TYPE_UNION; module-level constant + doc-comment style from `src/lib/format.ts`.
- **IMPORTS**: none.
- **GOTCHA**: `displayToKg(value,'kg')` must be exactly `value` (rounded to 2dp) so kg users never drift. Keep `kg` the identity path in both functions.
- **VALIDATE**: `npm test -- units` (after Task 2) passes.

### Task 2: Units tests (`src/lib/units.test.ts`)
- **ACTION**: Create unit tests mirroring `format.test.ts`.
- **IMPLEMENT** cases:
  - `kgToDisplay(100, 'kg') === 100`; `kgToDisplay(2.5, 'kg') === 2.5` (identity)
  - `kgToDisplay(100, 'lb') === 220.5` (100 / 0.45359237 = 220.462… → 220.5)
  - `displayToKg(100, 'kg') === 100` (identity)
  - `displayToKg(220.5, 'lb')` ≈ `100.04` (assert `toBeCloseTo(100.04, 2)`)
  - `isWeightUnit('kg') === true`, `isWeightUnit('lb') === true`, `isWeightUnit('stone') === false`, `isWeightUnit(undefined) === false`
- **MIRROR**: TEST_STRUCTURE (pure util).
- **IMPORTS**: `import { describe, it, expect } from 'vitest'`.
- **GOTCHA**: lb round-trips are lossy by design — use `toBeCloseTo`, not `toBe`, for converted values.
- **VALIDATE**: `npm test -- units` → all pass.

### Task 3: Add `userPreferences` to schema (`src/db/schema.ts`)
- **ACTION**: Append a new table.
- **IMPLEMENT**:
  ```ts
  export const userPreferences = pgTable('user_preferences', {
    userId: text('user_id').primaryKey(), // Clerk user id; one row per user
    unit: text('unit').notNull().default('kg'), // weight display unit: 'kg' | 'lb'
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  })
  ```
- **MIRROR**: NAMING_CONVENTION (snake_case columns, trailing comments). `text`/`timestamp` already imported at `src/db/schema.ts:1-10`.
- **IMPORTS**: reuse existing imports; no new import needed.
- **GOTCHA**: `unit` is `text`, not a pg enum — keep it loose at the DB layer and enforce the union in app code (mirrors the repo's hand-rolled-validation philosophy). No `relations()` entry needed (not joined).
- **VALIDATE**: `npx tsc --noEmit` clean.

### Task 4: Generate + apply migration
- **ACTION**: Produce and run the migration for the new table.
- **IMPLEMENT**: `npm run db:generate` (writes a new file under `drizzle/`), then `npm run db:migrate`.
- **MIRROR**: existing `drizzle/0000_majestic_manta.sql` format.
- **IMPORTS**: n/a.
- **GOTCHA**: `drizzle.config.ts` reads `.env.local` and needs `DATABASE_URL_DIRECT` (port 5432 direct, NOT the 6543 pooler). If the env var is absent, `requireEnv` throws — set it before generating.
- **VALIDATE**: New SQL file contains `CREATE TABLE "user_preferences"`; `npm run db:migrate` exits 0.

### Task 5: Preferences data access (`src/db/preferences.ts`)
- **ACTION**: Create the user-scoped read/write helpers.
- **IMPLEMENT**:
  ```ts
  import { eq } from 'drizzle-orm'
  import { db } from './index'
  import { userPreferences } from './schema'
  import { DEFAULT_WEIGHT_UNIT, isWeightUnit, type WeightUnit } from '@/lib/units'

  /** Returns the user's weight unit, defaulting to kg when unset or unrecognized. */
  export async function getWeightUnit(userId: string): Promise<WeightUnit> {
    const [row] = await db
      .select({ unit: userPreferences.unit })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1)
    return row && isWeightUnit(row.unit) ? row.unit : DEFAULT_WEIGHT_UNIT
  }

  /** Upserts the user's weight unit. */
  export async function setWeightUnit(userId: string, unit: WeightUnit): Promise<void> {
    await db
      .insert(userPreferences)
      .values({ userId, unit })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { unit, updatedAt: new Date() } })
  }
  ```
- **MIRROR**: DATA_ACCESS_MODULE (`src/db/workouts.ts`) — `userId` first, doc comments.
- **IMPORTS**: as shown; `@/` alias works in app/test code (only `drizzle.config.ts` can't use it).
- **GOTCHA**: `getWeightUnit` must never throw on a missing row — return `DEFAULT_WEIGHT_UNIT`. Guard `row.unit` with `isWeightUnit` since the column is loose `text`.
- **VALIDATE**: `npm test -- preferences` (after Task 6).

### Task 6: Preferences tests (`src/db/preferences.test.ts`)
- **ACTION**: Test default fallback + upsert payload using the mocked-db pattern.
- **IMPLEMENT**: `vi.mock('./index', ...)` exposing a `db` whose `select().from().where().limit()` returns a controllable rows array, and whose `insert().values().onConflictDoUpdate()` records its args. Cases:
  - no row → `getWeightUnit` returns `'kg'`
  - row `{ unit: 'lb' }` → returns `'lb'`
  - row `{ unit: 'garbage' }` → returns `'kg'` (guard)
  - `setWeightUnit(user,'lb')` → records `values({ userId, unit: 'lb' })` and an `onConflictDoUpdate` with `set.unit === 'lb'`
- **MIRROR**: TEST_STRUCTURE (db module) from `src/db/save-workout.test.ts`.
- **IMPORTS**: `import { describe, it, expect, vi, beforeEach } from 'vitest'`.
- **GOTCHA**: the builder is chainable — each mocked method returns the next link; `limit` resolves to the rows array (thenable or plain array the helper destructures with `const [row] =`).
- **VALIDATE**: `npm test -- preferences` → all pass.

### Task 7: Unit-aware `formatSet` (`src/lib/format.ts`)
- **ACTION**: Add a `unit` parameter (default `'kg'`) and convert the stored kg.
- **IMPLEMENT**:
  ```ts
  import { kgToDisplay, type WeightUnit } from './units'

  export function formatSet(
    reps: number | null,
    weightKg: number | null,
    unit: WeightUnit = 'kg',
  ): string {
    const weight = weightKg !== null ? `${kgToDisplay(weightKg, unit)} ${unit}` : null
    if (reps !== null && weight !== null) return `${reps} × ${weight}`
    if (reps !== null) return `${reps} reps`
    if (weight !== null) return weight
    return '—'
  }
  ```
- **MIRROR**: existing `formatSet` shape — only the weight string becomes unit-derived.
- **IMPORTS**: add `import { kgToDisplay, type WeightUnit } from './units'`.
- **GOTCHA**: default `'kg'` keeps every existing call site and test green; only the detail page passes a real unit.
- **VALIDATE**: `npm test -- format`.

### Task 8: Extend `format.test.ts`
- **ACTION**: Add lb cases; leave kg-default cases unchanged.
- **IMPLEMENT**:
  - `formatSet(5, 100, 'lb')` → `'5 × 220.5 lb'`
  - `formatSet(null, 100, 'lb')` → `'220.5 lb'`
  - `formatSet(5, 100)` still → `'5 × 100 kg'` (unchanged, proves default)
- **MIRROR**: existing describe/it block.
- **VALIDATE**: `npm test -- format` → all pass.

### Task 9: Unit-aware draft mappers (`src/app/workout/new/workout-draft.ts`)
- **ACTION**: Thread `unit` (default `'kg'`) through `draftToInput` and `detailToDraft`.
- **IMPLEMENT**:
  - Import: `import { displayToKg, kgToDisplay, type WeightUnit } from '@/lib/units'`
  - `draftToInput(draft, name?, unit: WeightUnit = 'kg')`: in the set map, `const w = toWeight(set.weight); weight: w === null ? null : displayToKg(w, unit)`
  - `detailToDraft(workout, unit: WeightUnit = 'kg')`: `weight: set.weight === null ? '' : kgToDisplay(set.weight, unit).toString()`
- **MIRROR**: BOUNDARY_MAPPER; keep `toWeight`/`toReps` untouched (they parse strings; conversion happens after).
- **IMPORTS**: as above.
- **GOTCHA**: order matters — `toWeight` first (string→number in display unit), then `displayToKg`. With default `'kg'`, `displayToKg`/`kgToDisplay` are identity, so existing tests stay green.
- **VALIDATE**: `npm test -- workout-draft`.

### Task 10: Extend `workout-draft.test.ts`
- **ACTION**: Add lb-conversion cases; keep kg-default cases.
- **IMPLEMENT**:
  - `draftToInput(draftWith('100'), undefined, 'lb')` → set weight `toBeCloseTo(45.36, 2)` (100 lb → 45.359 kg → 45.36)
  - `detailToDraft(workoutWithKg(100), 'lb')` → set weight string `'220.5'`
  - existing default-`kg` assertions unchanged
- **MIRROR**: existing describe blocks; reuse the `SQUAT`/`NESTED` fixtures.
- **VALIDATE**: `npm test -- workout-draft` → all pass.

### Task 11: Logger accepts `unit` (`src/app/workout/new/workout-logger.tsx`)
- **ACTION**: Add `unit` to props, use it for the weight input and for both mapper calls.
- **IMPLEMENT**:
  - Props: add `unit?: WeightUnit` (default `'kg'`); `import { type WeightUnit } from '@/lib/units'`
  - Weight `<Input>`: `placeholder={unit}` and `aria-label={\`Set ${setIndex + 1} weight in ${unit}\`}`
  - Save: `draftToInput(draft, name, unit)` in both the create and update branches
  - (Edit pre-fill conversion is done by the page via `detailToDraft`, Task 13)
- **MIRROR**: existing prop destructuring with defaults (`initialDraft = emptyDraft`).
- **IMPORTS**: add the `WeightUnit` type import.
- **GOTCHA**: the draft now holds display-unit strings; do NOT convert inside the reducer — only at the `draftToInput` boundary.
- **VALIDATE**: `npx tsc --noEmit` clean; manual logger check in Task 16.

### Task 12: New-workout page passes unit (`src/app/workout/new/page.tsx`)
- **ACTION**: Read the unit server-side and pass it to the logger.
- **IMPLEMENT**:
  ```ts
  const userId = await requireUserId()
  const unit = await getWeightUnit(userId)
  ...
  <WorkoutLogger unit={unit} />
  ```
- **MIRROR**: how `page.tsx` reads `userId` then data.
- **IMPORTS**: `import { getWeightUnit } from '@/db/preferences'`.
- **GOTCHA**: `requireUserId()` currently returns `void` here (called without capture) — capture its return now.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 13: Edit page passes unit (`src/app/workout/[id]/edit/page.tsx`)
- **ACTION**: Read unit; convert pre-fill and pass to logger.
- **IMPLEMENT**:
  ```ts
  const unit = await getWeightUnit(userId)
  const { draft, name } = detailToDraft(workout, unit)
  ...
  <WorkoutLogger workoutId={id} initialDraft={draft} initialName={name} unit={unit} />
  ```
- **MIRROR**: existing structure (`detailToDraft(workout)` call at line 20).
- **IMPORTS**: `import { getWeightUnit } from '@/db/preferences'`.
- **GOTCHA**: pre-fill and logger MUST use the same unit or the displayed value won't match the placeholder.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 14: Detail page passes unit (`src/app/workout/[id]/page.tsx`)
- **ACTION**: Read unit; pass to `formatSet`.
- **IMPLEMENT**:
  ```ts
  const unit = await getWeightUnit(userId)
  ...
  <span>{formatSet(set.reps, set.weight, unit)}</span>
  ```
- **MIRROR**: existing `formatSet(set.reps, set.weight)` call at line 51.
- **IMPORTS**: `import { getWeightUnit } from '@/db/preferences'`.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 15: Server action + toggle (`src/app/actions.ts`, `src/components/unit-toggle.tsx`, `src/app/page.tsx`)
- **ACTION**: Persist the choice and surface the toggle.
- **IMPLEMENT**:
  - `src/app/actions.ts`:
    ```ts
    'use server'
    import { revalidatePath } from 'next/cache'
    import { requireUserId } from '@/lib/auth'
    import { setWeightUnit } from '@/db/preferences'
    import { isWeightUnit } from '@/lib/units'

    export async function setWeightUnitAction(unit: unknown): Promise<void> {
      const userId = await requireUserId()
      if (!isWeightUnit(unit)) throw new Error('invalid weight unit')
      await setWeightUnit(userId, unit)
      revalidatePath('/', 'layout') // refresh every weight display
    }
    ```
  - `src/components/unit-toggle.tsx` (client): `useTransition` + `useRouter`; render `WEIGHT_UNITS.map` of `<Button size="sm" variant={u === unit ? 'default' : 'ghost'} aria-pressed={u === unit} disabled={isPending} onClick={() => select(u)}>{u}</Button>` inside a `<div role="group" aria-label="Weight unit">`; `select` no-ops when `next === unit`, else `await setWeightUnitAction(next); router.refresh()`.
  - `src/app/page.tsx`: `const unit = await getWeightUnit(userId)`; render `<UnitToggle unit={unit} />` in the header before `<UserButton />` (wrap both in a `flex items-center gap-2`).
- **MIRROR**: SERVER_ACTION (`src/app/workout/actions.ts`); CLIENT_ACTION_WIRING + VALIDATION_GUARD.
- **IMPORTS**: page adds `import { getWeightUnit } from '@/db/preferences'` and `import { UnitToggle } from '@/components/unit-toggle'`.
- **GOTCHA**: `revalidatePath('/', 'layout')` (not just `'/'`) so detail/new/edit pages re-render in the new unit too. `router.refresh()` re-runs the server components without a full reload.
- **VALIDATE**: `npx tsc --noEmit`; manual toggle check in Task 16.

### Task 16: Manual + full verification
- **ACTION**: Run the full suite and a manual smoke test.
- **VALIDATE**: see Validation Commands.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| kgToDisplay identity | `(100,'kg')` | `100` | no |
| kgToDisplay lb | `(100,'lb')` | `220.5` | no |
| displayToKg identity | `(100,'kg')` | `100` | no |
| displayToKg lb | `(100,'lb')` | `≈45.36` | rounding |
| isWeightUnit reject | `('stone')` / `undefined` | `false` | invalid input |
| getWeightUnit default | no row | `'kg'` | empty |
| getWeightUnit bad value | `{unit:'garbage'}` | `'kg'` | corrupt data |
| setWeightUnit upsert | `(user,'lb')` | records `unit:'lb'` + onConflict set | — |
| formatSet lb | `(5,100,'lb')` | `'5 × 220.5 lb'` | no |
| formatSet kg default | `(5,100)` | `'5 × 100 kg'` | back-compat |
| draftToInput lb | `'100'`, `'lb'` | weight `≈45.36` | conversion |
| detailToDraft lb | `100` kg, `'lb'` | `'220.5'` | conversion |

### Edge Cases Checklist
- [x] Empty input (no preferences row → default kg)
- [x] Invalid types (`isWeightUnit` rejects; action throws)
- [x] Corrupt stored value (`getWeightUnit` guards bad text → kg)
- [x] Blank weight field (`toWeight` → null → stays null, no conversion)
- [ ] Maximum size input — existing `MAX_WEIGHT` (9999.99 kg) check in `parseWorkoutInput` is unchanged; lb entry of a huge number converts to >9999.99 kg and is rejected server-side (acceptable; note in Risks)
- [x] Concurrent access — upsert via `onConflictDoUpdate` is safe
- [ ] Network failure — toggle action throws; left unhandled (toggle is non-critical); acceptable for POC

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit --pretty false
```
EXPECT: Zero type errors

### Unit Tests (affected)
```bash
npm test -- units preferences format workout-draft
```
EXPECT: All pass

### Full Test Suite
```bash
npm test
```
EXPECT: No regressions (existing 76 unit tests + new tests green)

### Lint
```bash
npm run lint
```
EXPECT: No errors

### Database Validation
```bash
npm run db:generate   # creates drizzle/<n>_*.sql with CREATE TABLE "user_preferences"
npm run db:migrate    # applies it
```
EXPECT: Migration generated and applied; exit 0

### Browser Validation
```bash
npm run dev
```
EXPECT: Feature works as designed (manual checklist below)

### Manual Validation
- [ ] Home header shows a `kg | lb` toggle; `kg` is active by default
- [ ] Tap `lb` → toggle updates without full reload
- [ ] Open an existing workout's detail → weights now read in lb (e.g. `220.5 lb`)
- [ ] Start a new workout → weight input placeholder reads `lb`; enter `135`, save
- [ ] Re-open that workout → shows `≈135 lb`; switch back to `kg` → shows `≈61.2 kg`
- [ ] Edit that workout → weight field pre-fills in the current unit and matches the placeholder

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing (conversion, preferences, format, draft mappers)
- [ ] No type errors
- [ ] No lint errors
- [ ] Toggle persists across reloads (stored in `user_preferences`)
- [ ] kg users see no behavior change (default path is identity)

## Completion Checklist
- [ ] Code follows discovered patterns (data-access module, server action, boundary mapper)
- [ ] Error handling matches codebase style (throw at boundaries; guard untrusted input)
- [ ] No `console.log`
- [ ] Tests follow vitest AAA style
- [ ] No hardcoded `kg` strings remain in display/input paths (search: `grep -rn "kg" src`)
- [ ] No unnecessary scope additions (no per-exercise units, no settings page)
- [ ] Self-contained — implemented without further codebase searching

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| lb→kg→lb round-trip drift on repeated edits | M | Low | Store at 2dp; display at 1dp; documented; snapping deferred |
| `DATABASE_URL_DIRECT` missing → `db:generate` throws | M | Med | Task 4 GOTCHA: set it (5432 direct) before generating |
| Large lb entry converts above `numeric(6,2)` ceiling | L | Low | Existing server-side `MAX_WEIGHT` check rejects with a clear error |
| Missed weight render site still prints kg | L | Med | `grep -rn "kg" src` in completion check; `formatSet` is the only display point today |
| Toggle action network failure unhandled | L | Low | Non-critical control; acceptable for POC |

## Notes
- **Storage decision (resolves PRD open question)**: a `user_preferences` table, not localStorage — every weight is rendered in `async` Server Components (`page.tsx`, `[id]/page.tsx`), so the unit must be readable server-side to avoid hydration flicker and SSR-incorrect output.
- **Back-compat strategy**: every changed function signature defaults `unit` to `'kg'`, and both conversion functions are the identity for `'kg'`, so all existing tests and call sites remain correct with zero churn — only the four pages that read the preference opt into real conversion.
- **Single conversion source**: all kg↔display math lives in `src/lib/units.ts`; no view does ad-hoc arithmetic (prevents the drift risk the PRD flagged).
