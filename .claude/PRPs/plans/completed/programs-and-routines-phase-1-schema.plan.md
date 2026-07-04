# Plan: Programs & Routines — Phase 1 (Schema + Zod + Metric Model)

## Summary
Add the data foundation for first-class training Programs: a `programs → program_days → program_exercises → program_sets` typed hierarchy mirroring the existing workout tree, a narrow Zod-validated JSONB tail (`technique`, `progression`), a timed-exercise metric model (`metric_mode`/`duration_sec`/`distance_m`) on **both** `program_sets` and the live `sets` table, and provenance columns (`program_day_id`/`program_week`) on `workouts`. Ships with `src/db/programs.ts` user-scoped ops and one migration. No MCP tools or UI yet — that is Phase 2+.

## User Story
As an intermediate→advanced lifter (or my agent), I want a first-class Programs data model with typed planned targets and timed-exercise support, so that a later phase can let me author a reusable mesocycle and instantiate dated, target-bearing workouts without templates polluting my real history.

## Problem → Solution
Today the only entity is a dated `workout`; there is no concept of a *plan*, and the workaround (blank-weight "template" workouts) blends plans into history and corrupts `get_last_performance`. → A structural twin of the workout tree stores **plans** separately from **reality**, with planned targets as typed columns and the polymorphic technique/progression tail as narrow JSONB. This phase lays only the schema/validation/DB-ops foundation that every later phase builds on.

## Metadata
- **Complexity**: Large
- **Source PRD**: `.claude/PRPs/prds/programs-and-routines.prd.md`
- **PRD Phase**: Phase 1 — Schema + Zod + metric model
- **Estimated Files**: 4 new (`src/db/programs.ts`, `src/lib/program-input.ts`, 2 test files) + 1 generated migration; 2 edited (`src/db/schema.ts`, `src/db/schema.test.ts`)

---

## UX Design

Internal change — no user-facing UX transformation. This phase adds tables, validation, and DB functions only; nothing is wired to the MCP surface or the web UI until Phase 2/Phase 6.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| `sets` table | reps/weight only | + `metric_mode` (default `reps_weight`), `duration_sec`, `distance_m` (nullable) | Additive; existing logging path keeps using defaults, no behavior change |
| `workouts` table | no plan link | + nullable `program_day_id` (`onDelete: set null`), `program_week` | Provenance only; null for all existing rows |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 (critical) | `src/db/schema.ts` | 1-81 | The exact Drizzle conventions to mirror: `pgTable`, snake_case columns, `numeric(6,2, mode:number)` kg, `references(... onDelete)`, `index`, deferrable `unique`, `relations` |
| P0 (critical) | `src/db/workouts.ts` | 119-233 | The transactional insert/replace + ownership pattern to mirror: `insertWorkoutChildren`, `saveWorkout`, `updateWorkout`, `deleteWorkout`, `getWorkoutDetail` |
| P0 (critical) | `src/lib/workout-input.ts` | 1-147 | The validation boundary being upgraded to Zod here; `MAX_WEIGHT`/`MAX_NAME`/`MAX_REPS` bounds, the "fresh object, never mutate, clear message" contract |
| P1 (important) | `drizzle/0002_tiny_stellaris.sql` | all | The hand-written `DEFERRABLE INITIALLY DEFERRED` migration to replicate for `program_sets`’ unique constraint (drizzle-kit cannot emit DEFERRABLE) |
| P1 (important) | `src/db/save-workout.test.ts` | all | The recording-stub transaction test pattern to mirror for `saveProgram` |
| P1 (important) | `src/lib/workout-input.test.ts` | all | The validation test pattern (AAA, `it.each` for rejects) to mirror for `program-input` |
| P2 (reference) | `src/db/schema.test.ts` | all | The schema-introspection test pattern (`getTableName`, `getTableColumns`) to extend |
| P2 (reference) | `drizzle.config.ts` | all | DDL uses `DATABASE_URL_DIRECT` (5432), not the 6543 pooler; how migrations are generated |
| P2 (reference) | `src/lib/units.ts` | 1-40 | Confirms weights are canonical **kg**; `suggested_load_kg` follows the same rule (conversion happens at the MCP boundary in Phase 2, not here) |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Zod 4 | already installed (`zod@^4.4.3` in package.json) | No install needed. Use `z.enum`, `z.discriminatedUnion`, `.nullable().optional()`, `.default()`, `z.infer<typeof schema>`; `.parse()` throws `ZodError` |
| Drizzle `jsonb` + `$type` | drizzle-orm 0.45 | `jsonb('col').$type<MyType>()` types the column to the Zod-inferred type; validation is enforced by Zod at the boundary, not by Postgres |

No external research needed beyond the above — feature uses established internal patterns (the PRD calls feasibility HIGH: the program tree is a structural twin of the workout tree).

---

## Patterns to Mirror

### NAMING_CONVENTION (tables, columns, constraints, relations)
```ts
// SOURCE: src/db/schema.ts:14-55
export const sets = pgTable(
  'sets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workoutExerciseId: uuid('workout_exercise_id')
      .notNull()
      .references(() => workoutExercises.id, { onDelete: 'cascade' }),
    setNumber: integer('set_number').notNull(),
    weight: numeric('weight', { precision: 6, scale: 2, mode: 'number' }), // kg
    completed: boolean('completed').notNull().default(false),
  },
  (t) => [unique('sets_exercise_set_number_unique').on(t.workoutExerciseId, t.setNumber)],
)
// camelCase TS field ↔ snake_case DB column; userId is `text` (Clerk id); index on the user column.
```

### RELATIONS
```ts
// SOURCE: src/db/schema.ts:63-80
export const workoutExercisesRelations = relations(workoutExercises, ({ one, many }) => ({
  workout: one(workouts, { fields: [workoutExercises.workoutId], references: [workouts.id] }),
  sets: many(sets),
}))
```

### REPOSITORY_PATTERN (user-scoped ops + transactional nested insert)
```ts
// SOURCE: src/db/workouts.ts:143-199
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function insertWorkoutChildren(tx: Tx, workoutId: string, exercises: WorkoutInput['exercises']) {
  for (const [position, exercise] of exercises.entries()) {
    const [we] = await tx.insert(workoutExercises)
      .values({ workoutId, wgerExerciseId: exercise.wgerExerciseId, name: exercise.name, position })
      .returning({ id: workoutExercises.id })
    if (exercise.sets.length > 0) {
      await tx.insert(sets).values(exercise.sets.map((s, i) => ({
        workoutExerciseId: we.id, setNumber: i + 1, reps: s.reps, weight: s.weight,
      })))
    }
  }
}

export async function saveWorkout(userId: string, input: WorkoutInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [workout] = await tx.insert(workouts).values({ userId, name: input.name }).returning({ id: workouts.id })
    await insertWorkoutChildren(tx, workout.id, input.exercises)
    return { id: workout.id }
  })
}
```

### OWNERSHIP_GATE (update/delete return-row as the gate)
```ts
// SOURCE: src/db/workouts.ts:215-233, 201-207
// updateWorkout: the `update ... returning` IS the ownership check — no row back ⇒ not owned ⇒ mutate nothing.
const [owned] = await tx.update(workouts).set({ name: input.name ?? null })
  .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
  .returning({ id: workouts.id })
if (!owned) return null
await tx.delete(workoutExercises).where(eq(workoutExercises.workoutId, id)) // cascade clears sets
await insertWorkoutChildren(tx, id, input.exercises)
```

### NESTED_READ (Drizzle query API with ordered children)
```ts
// SOURCE: src/db/workouts.ts:120-130
export function getWorkoutDetail(userId: string, id: string) {
  return db.query.workouts.findFirst({
    where: and(eq(workouts.id, id), eq(workouts.userId, userId)),
    with: { exercises: { orderBy: (e) => [asc(e.position)], with: { sets: { orderBy: (s) => [asc(s.setNumber)] } } } },
  })
}
```

### VALIDATION_BOUNDARY (the Zod upgrade path this phase takes)
```ts
// SOURCE: src/lib/workout-input.ts:11-15, 42-47
// "The upgrade path is to replace the body of parseWorkoutInput with a Zod schema while keeping the same signature."
export const MAX_WEIGHT = 9999.99 // sets.weight is numeric(6,2) ⇒ 9999.99 ceiling — reuse this bound for suggested_load_kg
const MAX_NAME = 200
const MAX_REPS = 10_000
```

### DEFERRABLE_UNIQUE migration (hand-written; drizzle-kit can't emit it)
```sql
-- SOURCE: drizzle/0002_tiny_stellaris.sql:1-6
-- DEFERRABLE INITIALLY DEFERRED: uniqueness checked at COMMIT, so an in-place
-- renumber (Phase 4 reorder/remove) that transiently collides still commits,
-- while two concurrent inserts of the same number are still rejected.
ALTER TABLE "sets" ADD CONSTRAINT "sets_exercise_set_number_unique"
  UNIQUE("workout_exercise_id","set_number") DEFERRABLE INITIALLY DEFERRED;
```

### TEST_STRUCTURE — recording-stub transaction test
```ts
// SOURCE: src/db/save-workout.test.ts:11-41
const records: { values: unknown }[] = []
let idCounter = 0
const ID_SEQUENCE = ['w1', 'e1', 's1', 'e2', 's2']
function makeTx() {
  return { insert: () => ({ values: (v: unknown) => { records.push({ values: v }); return { returning: () => Promise.resolve([{ id: ID_SEQUENCE[idCounter++] }]) } } }) }
}
vi.mock('./index', () => ({ db: { transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()) } }))
```

### TEST_STRUCTURE — schema introspection
```ts
// SOURCE: src/db/schema.test.ts:5-15
expect(getTableName(workouts)).toBe('workouts')
expect(getTableColumns(sets).completed.notNull).toBe(true)
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/program-input.ts` | CREATE | Zod schemas + inferred types: `programInputSchema` and the `technique`/`progression` JSONB contracts; `parseProgramInput`. The single source of truth the DB `$type<>()` and (later) MCP input both use. |
| `src/db/schema.ts` | UPDATE | Add `programs`/`programDays`/`programExercises`/`programSets` tables + relations; add `metricMode`/`durationSec`/`distanceM` to `sets`; add `programDayId`/`programWeek` to `workouts`. |
| `src/db/programs.ts` | CREATE | User-scoped ops mirroring `workouts.ts`: `listPrograms`, `getProgramDetail`, `saveProgram`, `updateProgram`, `deleteProgram`, `setProgramStatus`. |
| `drizzle/0003_*.sql` | CREATE (generated, then hand-edited) | `npm run db:generate` output; hand-edit the `program_sets` unique to `DEFERRABLE INITIALLY DEFERRED`. |
| `src/lib/program-input.test.ts` | CREATE | Validation tests mirroring `workout-input.test.ts`. |
| `src/db/save-program.test.ts` | CREATE | Transactional-insert order/linkage test mirroring `save-workout.test.ts`. |
| `src/db/schema.test.ts` | UPDATE | Extend with the four new table names + new column defaults/notNull assertions. |

## NOT Building (this phase)

- **Any MCP tool or resource** (`upsert_program`, `get_program`, `program://{id}`, `assertProgramIdShape`) — Phase 2.
- **`instantiate_program_day`, seeding live `sets`, `get_workout` plan overlay** — Phase 3.
- **Granular patch tools / reorder** — Phase 4.
- **The progression *engine*** (computing week-N targets, %1RM/RPE tables, MEV→MRV, deload math) and **technique execution** — Phase 5. This phase only defines the JSONB *columns and Zod contract*; nothing consumes them yet.
- **Muscle-group tagging column** and **superset grouping column** — Phase 5 (omit now to keep the migration tight; they are additive nullable later).
- **Wiring `metric_mode`/`duration_sec`/`distance_m` into the live logging path** (`SetInput`, `saveWorkout`, `update_set`) — the columns land now (additive, defaulted) but timed *logging* is Phase 5. Existing inserts rely on the column defaults.
- **Web UI** — Phase 6.

---

## Data Model (decided — implement exactly this)

**`programs`** — top of the tree, the ownership root (mirrors `workouts`):
- `id` uuid pk · `userId` text notNull (Clerk id) · `name` text notNull · `status` text notNull default `'draft'` (`draft|active|archived`) · `mesocycleWeeks` integer notNull default `1` · `deloadWeek` integer (nullable; which 1-based week deloads, null=none) · `notes` text (nullable) · `createdAt` tz-timestamp default now notNull · `updatedAt` tz-timestamp default now notNull
- index: `programs_user_id_idx` on `userId`

**`program_days`** (mirrors the day-level grouping; 0-based `position`):
- `id` uuid pk · `programId` uuid notNull references `programs.id` `onDelete: 'cascade'` · `name` text notNull · `position` integer notNull default `0` · `notes` text (nullable)

**`program_exercises`** (mirrors `workout_exercises` + per-exercise progression tail):
- `id` uuid pk · `programDayId` uuid notNull references `program_days.id` `onDelete: 'cascade'` · `wgerExerciseId` integer notNull · `name` text notNull (denormalized) · `position` integer notNull default `0` · `progression` jsonb (nullable) `.$type<Progression>()`

**`program_sets`** (mirrors `sets` + typed planned targets + metric model + technique tail):
- `id` uuid pk · `programExerciseId` uuid notNull references `program_exercises.id` `onDelete: 'cascade'` · `setNumber` integer notNull (1-based)
- `setType` text notNull default `'working'` (`warmup|working|backoff|amrap`)
- `metricMode` text notNull default `'reps_weight'` (`reps_weight|duration|duration_distance`)
- `repMin` integer (nullable) · `repMax` integer (nullable) · `rir` integer (nullable) · `rpe` numeric(3,1, mode:number) (nullable)
- `suggestedLoadKg` numeric(6,2, mode:number) (nullable, **kg**) · `tempo` text (nullable)
- `durationSec` integer (nullable) · `distanceM` numeric(9,2, mode:number) (nullable)
- `technique` jsonb (nullable) `.$type<Technique>()`
- unique: `program_sets_exercise_set_number_unique` on (`programExerciseId`,`setNumber`) — **DEFERRABLE** (hand-edited migration)

**`sets`** (additive, nullable/defaulted — no regression):
- + `metricMode` text notNull default `'reps_weight'` · `durationSec` integer (nullable) · `distanceM` numeric(9,2, mode:number) (nullable)

**`workouts`** (additive provenance):
- + `programDayId` uuid (nullable) references `program_days.id` `onDelete: 'set null'` (editing/deleting a plan never destroys logged history) · `programWeek` integer (nullable)

> **Boundary rule applied** (PRD line 108): a field is a **column** if we filter/sort/aggregate/constrain on it or copy it into a `sets` row at instantiation (set_type, rep range, RIR/RPE, suggested load, metric mode, duration/distance, tempo). **JSONB** only for the polymorphic value read whole when rendering one exercise (`technique` stages, `progression` params). `metric_mode` gates e1RM/volume math later, so it is a column.

> **Relation ordering note**: `workouts` now also carries `programDayId`. For Phase 1, only add the relations needed for `getProgramDetail` (programs→days→exercises→sets). Do **not** add a `workouts.programDay` relation yet — it isn't read until Phase 3, and adding it now is speculative (YAGNI).

## Zod / `program-input.ts` contract

```ts
// Enums
metricModeSchema = z.enum(['reps_weight', 'duration', 'duration_distance'])
setTypeSchema    = z.enum(['warmup', 'working', 'backoff', 'amrap'])
statusSchema     = z.enum(['draft', 'active', 'archived'])

// Narrow JSONB tail — discriminator + version (risk mitigation: tolerant, versioned).
// Phase 1 fixes the SHAPE; Phase 5 owns the exhaustive per-variant params + the engine.
techniqueSchema = z.object({
  version: z.literal(1).default(1),
  kind: z.enum(['drop-set', 'rest-pause', 'myo-reps', 'cluster']),
  stages: z.array(z.object({
    loadKg: z.number().min(0).max(MAX_WEIGHT).nullable().optional(),
    reps: z.number().int().min(0).max(MAX_REPS).nullable().optional(),
    restSec: z.number().int().min(0).optional(),
  })).min(1),
}).strict()

progressionSchema = z.discriminatedUnion('scheme', [
  z.object({ scheme: z.literal('linear'),              incrementKg: z.number() }),
  z.object({ scheme: z.literal('double-progression'),  repMin: z.number().int(), repMax: z.number().int(), incrementKg: z.number() }),
  z.object({ scheme: z.literal('percent-1rm'),         trainingMaxKg: z.number(), weekPercents: z.array(z.number()) }),
  z.object({ scheme: z.literal('rpe-target'),          targetRpe: z.number() }),
  z.object({ scheme: z.literal('weekly-volume'),       mevSets: z.number().int(), mrvSets: z.number().int() }),
]) // NOTE: each variant carries the discriminator + minimal params now; Phase 5 tightens.

// Per-set planned target (kg canonical; conversion is the MCP layer's job in Phase 2)
programSetSchema = z.object({
  setType: setTypeSchema.default('working'),
  metricMode: metricModeSchema.default('reps_weight'),
  repMin: z.number().int().min(0).max(MAX_REPS).nullable().optional(),
  repMax: z.number().int().min(0).max(MAX_REPS).nullable().optional(),
  rir: z.number().int().min(0).max(20).nullable().optional(),
  rpe: z.number().min(0).max(10).nullable().optional(),
  suggestedLoadKg: z.number().min(0).max(MAX_WEIGHT).nullable().optional(),
  tempo: z.string().max(20).nullable().optional(),
  durationSec: z.number().int().min(0).nullable().optional(),
  distanceM: z.number().min(0).max(9_999_999.99).nullable().optional(),
  technique: techniqueSchema.nullable().optional(),
}).superRefine((s, ctx) => {
  // metric_mode integrity: timed/timed-distance sets must carry a planned duration
  if (s.metricMode !== 'reps_weight' && (s.durationSec === undefined || s.durationSec === null)) {
    ctx.addIssue({ code: 'custom', message: 'duration_sec is required when metric_mode is duration or duration_distance', path: ['durationSec'] })
  }
  if (s.repMin != null && s.repMax != null && s.repMin > s.repMax) {
    ctx.addIssue({ code: 'custom', message: 'repMin must be ≤ repMax', path: ['repMin'] })
  }
})

programExerciseSchema = z.object({
  wgerExerciseId: z.number().int(),
  name: z.string().trim().min(1).max(MAX_NAME),
  progression: progressionSchema.nullable().optional(),
  sets: z.array(programSetSchema).min(1),
})

programDaySchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME),
  notes: z.string().max(2000).nullable().optional(),
  exercises: z.array(programExerciseSchema).min(1),
})

programInputSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME),
  status: statusSchema.default('draft'),
  mesocycleWeeks: z.number().int().min(1).max(52).default(1),
  deloadWeek: z.number().int().min(1).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  days: z.array(programDaySchema).min(1),
})

export type Technique = z.infer<typeof techniqueSchema>
export type Progression = z.infer<typeof progressionSchema>
export type ProgramInput = z.infer<typeof programInputSchema>
export function parseProgramInput(input: unknown): ProgramInput { return programInputSchema.parse(input) }
```
> `position` is **not** in the input schema — it is assigned by array index at insert (mirrors `insertWorkoutChildren`’s `.entries()`). `setNumber` likewise assigned `i + 1`.
> Reuse `MAX_WEIGHT` by importing from `workout-input.ts`; re-declare `MAX_NAME = 200` and `MAX_REPS = 10_000` locally (they are not exported there) with a comment that they mirror `workout-input.ts`.

---

## Step-by-Step Tasks

### Task 1: Zod contract — `src/lib/program-input.ts`
- **ACTION**: Create the Zod schemas + inferred types + `parseProgramInput` exactly as in the contract above.
- **IMPLEMENT**: All enums, `techniqueSchema`, `progressionSchema`, `programSetSchema` (with `.superRefine`), `programExerciseSchema`, `programDaySchema`, `programInputSchema`; export `Technique`, `Progression`, `ProgramInput`, `parseProgramInput`.
- **MIRROR**: VALIDATION_BOUNDARY — same "fresh object, clear message, never mutate" contract as `parseWorkoutInput`; same kg-canonical bound `MAX_WEIGHT`.
- **IMPORTS**: `import { z } from 'zod'`; `import { MAX_WEIGHT } from './workout-input'`.
- **GOTCHA**: `z.discriminatedUnion` requires a literal discriminator key on every member (`scheme`). Keep `technique`/`progression` params minimal here — Phase 5 owns the full set; over-specifying now is speculative and will churn.
- **VALIDATE**: `npx tsc --noEmit` clean; a quick `programInputSchema.parse(sample5DaySplit)` succeeds (covered by Task 5 tests).

### Task 2: Schema — extend `src/db/schema.ts`
- **ACTION**: Add the four program tables, their relations, the three new `sets` columns, and the two new `workouts` columns.
- **IMPLEMENT**: Per the Data Model section. Add `jsonb` to the `drizzle-orm/pg-core` import list. Type JSONB columns via `.$type<Technique>()` / `.$type<Progression>()` imported from `@/lib/program-input`. Declare `program_sets` unique as `unique('program_sets_exercise_set_number_unique').on(t.programExerciseId, t.setNumber)` and add a comment (like `sets`) that the migration makes it DEFERRABLE. Add `programsRelations` (many days), `programDaysRelations` (one program, many exercises), `programExercisesRelations` (one day, many sets), `programSetsRelations` (one exercise).
- **MIRROR**: NAMING_CONVENTION + RELATIONS.
- **IMPORTS**: extend existing `pgTable, uuid, text, integer, numeric, boolean, timestamp, index, unique` with `jsonb`; `import type { Technique, Progression } from '@/lib/program-input'`.
- **GOTCHA**: New `sets.metric_mode` is `notNull default 'reps_weight'` — safe for existing rows. New `workouts` columns and all `program_*` non-defaulted nullable columns must be nullable so the migration applies to a populated DB. `workouts.programDayId` is `onDelete: 'set null'` (NOT cascade) — deleting a program must not delete logged workouts.
- **VALIDATE**: `npx tsc --noEmit` clean; `npm run db:generate` produces a single new migration with no unexpected drops.

### Task 3: DB ops — `src/db/programs.ts`
- **ACTION**: Create user-scoped CRUD mirroring `workouts.ts`.
- **IMPLEMENT**:
  - `listPrograms(userId)` → select from `programs` where `userId`, `orderBy desc(updatedAt)`.
  - `getProgramDetail(userId, id)` → `db.query.programs.findFirst` with nested ordered `days → exercises → sets` (mirror NESTED_READ).
  - `saveProgram(userId, input: ProgramInput): Promise<{ id: string }>` → one `db.transaction`: insert `programs` row (userId, name, status, mesocycleWeeks, deloadWeek, notes), then `insertProgramChildren(tx, programId, input.days)` looping days(`position`=dayIndex) → exercises(`position`=exIndex, progression) → sets(`setNumber`=i+1, all typed columns + technique).
  - `updateProgram(userId, id, input): Promise<{ id: string } | null>` → transaction: `update programs ... returning` as ownership gate (also bump `updatedAt`); if none, return null; `delete programDays where programId=id` (cascade clears exercises+sets); re-insert children.
  - `deleteProgram(userId, id)` → delete where id+userId, returning id.
  - `setProgramStatus(userId, id, status): Promise<{ id: string } | null>` → `update programs set status, updatedAt where id+userId returning` (ownership gate).
  - Lift `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]` like workouts.ts.
- **MIRROR**: REPOSITORY_PATTERN + OWNERSHIP_GATE.
- **IMPORTS**: `import { and, asc, desc, eq } from 'drizzle-orm'`; `import { db } from './index'`; `import { programs, programDays, programExercises, programSets } from './schema'`; `import type { ProgramInput } from '@/lib/program-input'`.
- **GOTCHA**: This module is the authorization boundary (no Postgres RLS) — every query filters/gates on `userId`; children inherit ownership through the FK chain, exactly like `saveWorkout`. Do not query `program_*` tables without going through the owned root.
- **VALIDATE**: `npx tsc --noEmit`; Task 6 transaction test asserts insert order/linkage.

### Task 4: Migration — generate + hand-edit DEFERRABLE
- **ACTION**: Run `npm run db:generate`; open the new `drizzle/0003_*.sql`; change the `program_sets` unique constraint to `DEFERRABLE INITIALLY DEFERRED` with the explanatory comment from 0002.
- **IMPLEMENT**: Replace the generated `ADD CONSTRAINT "program_sets_exercise_set_number_unique" UNIQUE(...)` line with the deferrable form; prepend the same 5-line rationale comment style as `0002_tiny_stellaris.sql`.
- **MIRROR**: DEFERRABLE_UNIQUE migration.
- **IMPORTS**: n/a.
- **GOTCHA**: drizzle-kit will re-flatten the constraint to non-deferrable on the next `generate` if the schema can't express DEFERRABLE — accept the hand-edit as the source of truth for this migration (same as 0002; that drift is already tolerated in this repo). Verify the migration has **no** `DROP` of existing `sets`/`workouts` data and that added `sets.metric_mode` carries its `DEFAULT 'reps_weight'`.
- **VALIDATE**: Inspect the SQL; do **not** auto-apply to the live Supabase DB — applying (`npm run db:migrate`, which uses `DATABASE_URL_DIRECT`/5432) is a manual step the user runs (see Manual Validation).

### Task 5: Validation tests — `src/lib/program-input.test.ts`
- **ACTION**: Create tests mirroring `workout-input.test.ts`.
- **IMPLEMENT** (AAA + `it.each`): accepts a minimal valid program (one day, one exercise, one set) and applies defaults (`status:'draft'`, `mesocycleWeeks:1`, set `setType:'working'`, `metricMode:'reps_weight'`); trims names; rejects: empty `days`, empty `exercises`, empty `sets`, non-integer `wgerExerciseId`, blank exercise name, bad `metricMode`, `metric_mode:'duration'` with no `durationSec` (the superRefine), `repMin > repMax`, `suggestedLoadKg` over `MAX_WEIGHT`, unknown `technique.kind`, unknown `progression.scheme`. Confirm a valid `technique` (drop-set, one stage) and a valid `progression` (linear) parse.
- **MIRROR**: TEST_STRUCTURE — validation.
- **IMPORTS**: `import { describe, it, expect } from 'vitest'`; `import { parseProgramInput } from './program-input'`.
- **GOTCHA**: `parseProgramInput` throws `ZodError` (not a plain `Error`) — assert with `expect(() => ...).toThrow()` (optionally `/duration_sec/i` etc. against the issue message).
- **VALIDATE**: `npx vitest run src/lib/program-input.test.ts` green.

### Task 6: Transaction test — `src/db/save-program.test.ts`
- **ACTION**: Create a recording-stub transaction test mirroring `save-workout.test.ts`.
- **IMPLEMENT**: Stub `db.transaction`; `ID_SEQUENCE = ['p1','d1','e1','s1', ...]`. Call `saveProgram(USER, sample)` with one day → one exercise → two sets; assert recorded insert order/linkage: program row (`userId`,`name`,`status`,...), day (`programId:'p1'`, `position:0`), exercise (`programDayId:'d1'`, `position:0`), sets array (`programExerciseId:'e1'`, `setNumber:1/2`, typed fields). Assert positions are 0-based and `setNumber` 1-based; add a second exercise and assert it gets `position:1`.
- **MIRROR**: TEST_STRUCTURE — recording stub.
- **IMPORTS**: `import { describe, it, expect, vi, beforeEach } from 'vitest'`; import `saveProgram` after the `vi.mock('./index', ...)`.
- **GOTCHA**: The stub’s `makeTx` must support nested loops (day→exercise→sets), so `insert()` is generic and `returning()` walks `ID_SEQUENCE` by call order — same as the workout stub, just a deeper sequence.
- **VALIDATE**: `npx vitest run src/db/save-program.test.ts` green.

### Task 7: Extend schema introspection test — `src/db/schema.test.ts`
- **ACTION**: Add assertions for the four new tables + new column metadata.
- **IMPLEMENT**: `getTableName` for `programs`/`program_days`/`program_exercises`/`program_sets`; `getTableColumns(programSets).metricMode.notNull === true` and the default where introspectable; `getTableColumns(sets).metricMode.notNull === true`; `getTableColumns(workouts).programDayId.notNull === false`.
- **MIRROR**: TEST_STRUCTURE — schema introspection.
- **IMPORTS**: extend the existing import with the new table refs.
- **VALIDATE**: `npx vitest run src/db/schema.test.ts` green.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| valid minimal program | 1 day/1 ex/1 set | parsed, defaults applied | no |
| timed set missing duration | `metricMode:'duration'`, no `durationSec` | throws `/duration_sec/i` | yes |
| repMin > repMax | `repMin:12, repMax:8` | throws `/repMin/i` | yes |
| suggestedLoadKg over ceiling | `10_000` | throws | yes |
| empty days / exercises / sets | `[]` | throws | yes |
| unknown technique kind / progression scheme | bad literal | throws | yes |
| saveProgram order/linkage | 1 day/1 ex/2 sets | inserts program→day→exercise→sets, correct ids/positions/setNumbers | no |
| second exercise position | 2 exercises | `position: 0` then `1` | yes |
| schema tables exist | — | four snake_case names, defaults/notNull correct | no |

### Edge Cases Checklist
- [x] Empty input (empty days/exercises/sets all rejected)
- [x] Maximum size input (`MAX_WEIGHT`, `MAX_REPS`, `MAX_NAME`, `mesocycleWeeks ≤ 52` bounds)
- [x] Invalid types (non-integer `wgerExerciseId`, bad enums)
- [ ] Concurrent access (deferrable unique covers the future renumber race; no Phase-1 code exercises it — deferred to Phase 4)
- [ ] Network failure (n/a — no network in this phase)
- [x] Permission denied (ownership gate via `update/delete ... returning`; the not-owned→null path is unit-tested through the stub)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors (JSONB `$type<>()` wired to the Zod-inferred `Technique`/`Progression`).

### Unit Tests (affected area)
```bash
npx vitest run src/lib/program-input.test.ts src/db/save-program.test.ts src/db/schema.test.ts
```
EXPECT: All pass.

### Full Test Suite (no regressions)
```bash
npm run test   # vitest run src
```
EXPECT: All existing workout/MCP/preferences tests still green — the metric columns are additive/defaulted and nothing rewrites the live logging path.

### Lint
```bash
npm run lint
```
EXPECT: Clean.

### Database — migration generation
```bash
npm run db:generate
```
EXPECT: One new `drizzle/0003_*.sql`; review for: 4 `CREATE TABLE`, 3 `ALTER TABLE "sets" ADD COLUMN`, 2 `ALTER TABLE "workouts" ADD COLUMN`, FKs with the right `ON DELETE` (`cascade` within the program tree, `set null` for `workouts.program_day_id`), and the `program_sets` unique (hand-edit to DEFERRABLE). No destructive `DROP`.

### Manual Validation (user runs — touches the live dev DB)
- [ ] Review `drizzle/0003_*.sql` and confirm the DEFERRABLE hand-edit.
- [ ] `npm run db:migrate` against `DATABASE_URL_DIRECT` (5432). Confirm it applies cleanly to the populated DB (existing workouts get `program_day_id = NULL`, `metric_mode = 'reps_weight'`).
- [ ] (Optional) `npm run db:studio` — eyeball the four new tables and the new columns.

---

## Acceptance Criteria
- [ ] All seven tasks completed.
- [ ] `npx tsc --noEmit`, `npm run test`, `npm run lint` all pass.
- [ ] `npm run db:generate` yields one clean, non-destructive migration; `program_sets` unique is DEFERRABLE.
- [ ] Zod `programInputSchema` validates a sample 5-day split first try and rejects each malformed case in the table.
- [ ] Existing workout create/read/edit/patch + e1RM tests unchanged and green (PRD "No regression" metric).

## Completion Checklist
- [ ] New tables/columns follow `schema.ts` snake_case + `numeric(mode:number)` + `references onDelete` conventions.
- [ ] `programs.ts` filters/gates every query on `userId` (authorization boundary), mirroring `workouts.ts`.
- [ ] Validation throws clear messages; returns fresh objects; never mutates input.
- [ ] Tests follow the recording-stub + introspection + `it.each` patterns.
- [ ] No hardcoded weights/bounds beyond the shared `MAX_*` constants.
- [ ] `technique`/`progression` JSONB kept narrow (discriminator + version + minimal params); engine explicitly left to Phase 5.
- [ ] Self-contained — no codebase searching needed during implementation.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| drizzle-kit re-flattens DEFERRABLE on regen | M | Low | Accept hand-edit as source of truth (same as 0002); document in the migration comment; only regenerate deliberately |
| Adding NOT NULL column to populated `sets` fails | L | High | `metric_mode` ships `NOT NULL DEFAULT 'reps_weight'` — valid for existing rows; duration/distance are nullable |
| Over-specifying JSONB params now causes churn in Phase 5 | M | Low | Keep params minimal + versioned (`version: 1`, tolerant); Phase 5 tightens behind the version discriminator |
| Phase 1 PR exceeds the ~300-line review budget | M | Low | It is one coherent foundation (schema+zod+ops+migration+tests). If review-heavy, take it commit-by-commit: (1) zod, (2) schema+migration, (3) db ops, (4) tests |
| `numeric` mode mismatch (string vs number) | L | Med | Use `{ mode: 'number' }` on every `numeric` (mirrors `sets.weight`) so values are JS numbers, not strings |

## Notes
- This is **Phase 1 of 6**. It deliberately ships *only* the foundation: no MCP tool, no instantiation, no engine. The PRD's MVP (the hypothesis-validating author→log loop) is Phases 1+2+3; this plan unblocks both Phase 2 (coarse MCP authoring, which wraps `programs.ts`) and Phase 6 (UI, which consumes the same ops) — they can proceed in parallel once this lands.
- **Open questions from the PRD are intentionally untouched here** and do not block Phase 1: muscle-group taxonomy (Phase 5 column), per-week overrides (`mesocycleWeeks` + derived weeks is the chosen default; an escape-hatch table is a later migration if needed), RPE→%1RM table and week auto-advance (Phase 3/5). Phase 1 stores `mesocycleWeeks`/`deloadWeek` so those decisions have a home without committing to the math.
- `suggested_load_kg` is canonical kg with no conversion in this phase; the MCP boundary (Phase 2) applies `displayToKg`/`kgToDisplay` exactly as `patch-tools.ts` does for live sets.
