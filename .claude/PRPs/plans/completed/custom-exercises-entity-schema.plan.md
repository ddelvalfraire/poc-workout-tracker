# Plan: Custom Exercises — Phase 1: Entity + Schema

## Summary
Create the identity model for first-class custom exercises: a per-user `custom_exercises` table (app-side wger parity — the 5-field `Exercise` shape), a `source: 'wger' | 'custom'` discriminator column on `workout_exercises` and `program_exercises` (default `'wger'`), a migration that kills the negative-ID stopgap for good, and a user-scoped CRUD module (`create`/`update`/`list`, no delete) following the `db/programs.ts` auth-boundary conventions.

## User Story
As the app's owner, I want movements wger lacks to exist as first-class exercise records, so that I can program, log, and track them without mislabeled nearest-match data or invisible sign-bit conventions.

## Problem → Solution
Exercise identity is a bare integer `wgerExerciseId`; customs would only exist via a negative-ID convention nothing in the data explains. → A `custom_exercises` table owns the custom catalog per user, and a `source` discriminator makes identity the explicit composite `(source, id)`.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/custom-exercises.prd.md`
- **PRD Phase**: Phase 1 — Entity + schema
- **Estimated Files**: 8 (4 create, 3 update, 1 generated migration)

## Sequencing Note
The PRD sequences this feature after the program-stats phases. `program-stats-data-layer.plan.md` is still unimplemented, but Phase 1 touches none of the program-stats surfaces (no query-site widening happens until Phase 2), so this phase is safe to land first. **Phase 2 must not be planned/implemented until program-stats' data layer exists**, since it explicitly widens that module's grouping key.

---

## UX Design

N/A — internal change (schema + data-access layer only; no user-facing surface until Phase 4's MCP tools).

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/schema.ts` | all | Table conventions: snake_case names, comment style, user_id ownership roots, index/unique patterns |
| P0 | `src/db/programs.ts` | 26–35, 242–253 | Auth-boundary doc comment; `update…returning` ownership gate for the update helper |
| P0 | `src/lib/program-input.ts` | 18–32, 176–224 | Zod boundary conventions: enum schemas, trim/max bounds, `parseXInput` + inferred types |
| P1 | `src/db/preferences.ts` | all | Smallest user-scoped db module — module doc comment + JSDoc style |
| P1 | `src/db/preferences.test.ts` | all | Recording-stub test pattern for db modules (no real database) |
| P1 | `src/lib/wger.ts` | 37–47 | The `Exercise` interface — parity target for the table's columns |
| P2 | `src/db/schema.test.ts` | all | Introspection-based schema tests (`getTableColumns`, `getTableConfig`) |
| P2 | `drizzle/0004_glamorous_vin_gonzales.sql` | all | Hand-edited migration precedent (drizzle-kit output then manual SQL edits, with comments) |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| wger category set | `GET https://wger.de/api/v2/exercisecategory/` (verified 2026-07-04) | Exactly 8 fixed categories: Abs, Arms, Back, Calves, Cardio, Chest, Legs, Shoulders |
| Drizzle identity columns | drizzle-orm 0.45 (installed) | `integer('id').primaryKey().generatedAlwaysAsIdentity()` — customs need an **integer** PK (must fit the existing `integer` ref columns), not uuid |
| Drizzle text arrays | drizzle-orm 0.45 | `text('muscles').array()` maps to `text[]` |
| Drizzle check constraints | drizzle-orm 0.45 | `check('name', sql\`...\`)` in the table's third argument |

---

## Key Decisions (resolving PRD open questions for this phase)

1. **Custom ID space**: plain integer identity (own sequence). IDs may numerically collide with wger IDs — fine, identity is composite `(source, id)`. (PRD default, confirmed.)
2. **Muscle storage**: `text[]` columns (`muscles`, `muscles_secondary`), NOT child rows. Rationale: this is catalog/definition data mirroring the `Exercise` interface; nothing aggregates over `custom_exercises` rows. The `program_exercise_muscles` relation stays the aggregation surface (the columns-vs-JSON boundary rule from that table's comment) — Phase 3 feeds it *from* these arrays at author time. Muscle names are free-text (wger English names by convention); only **category** is enum-enforced per the PRD.
3. **Column naming**: KEEP `wgerExerciseId` / `wger_exercise_id` on the ref tables, with an updated comment noting it holds a `custom_exercises.id` when `source = 'custom'`. A rename would blow the diff across every query site for zero behavior — Phase 2 touches those sites anyway and can revisit.
4. **Negative-ID "backfill"**: verified zero negative-ID rows exist (spike cleanup). A data backfill cannot synthesize a valid category, so the migration instead (a) **guards**: a `DO` block RAISEs if any negative refs exist (forcing manual migration in the impossible case), and (b) **prevents forever**: `CHECK (wger_exercise_id > 0)` on both ref tables. This satisfies the success metric ("zero negative-ID references *possible* post-migration") more strongly than a backfill would. *Deviation from PRD wording, same intent — flagged.*
5. **Name uniqueness**: `UNIQUE (user_id, name)` on `custom_exercises` — prevents accidental duplicates from repeated MCP create calls. Exact-match only (case variants allowed); good enough for a single-user POC.

---

## Patterns to Mirror

### TABLE_DEFINITION (ownership root + comment style)
```ts
// SOURCE: src/db/schema.ts:102-116
export const programs = pgTable(
  'programs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // Clerk user id
    name: text('name').notNull(),
    status: text('status').notNull().default('draft'), // 'draft' | 'active' | 'archived'
    ...
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('programs_user_id_idx').on(t.userId)],
)
```

### APP_LEVEL_ENUM_COLUMN (text + $type, like set_type)
```ts
// SOURCE: src/db/schema.ts:164
setType: text('set_type').$type<SetType>().notNull().default('working'), // warmup|working|backoff|amrap
```

### ZOD_ENUM_AND_PARSE_BOUNDARY
```ts
// SOURCE: src/lib/program-input.ts:28,222-224
export const setTypeSchema = z.enum(['warmup', 'working', 'backoff', 'amrap'])
...
export function parseProgramInput(input: unknown): ProgramInput {
  return programInputSchema.parse(input)
}
```

### DB_MODULE_DOC_COMMENT (authorization boundary)
```ts
// SOURCE: src/db/programs.ts:26-35
/**
 * Data access for training programs, always scoped to a Clerk userId.
 *
 * Like `db/workouts.ts`, this module is the authorization boundary: the app has
 * no Postgres row-level security, so every query filters by `user_id` ...
 */
```

### OWNERSHIP_GATED_UPDATE (update…returning, null = not owned)
```ts
// SOURCE: src/db/programs.ts:242-253
export async function setProgramStatus(userId: string, id: string, status: ...): Promise<{ id: string } | null> {
  const [owned] = await db
    .update(programs)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(programs.id, id), eq(programs.userId, userId)))
    .returning({ id: programs.id })
  return owned ?? null
}
```

### LIST_QUERY (user-scoped, ordered)
```ts
// SOURCE: src/db/programs.ts:38-44
export function listPrograms(userId: string) {
  return db.select().from(programs).where(eq(programs.userId, userId)).orderBy(desc(programs.updatedAt))
}
```

### TEST_STRUCTURE (recording stubs, no real DB)
```ts
// SOURCE: src/db/preferences.test.ts:1-52
// - vi.mock('./index', ...) replaces `db` with chainable recording builders
// - reads resolve a controllable `selectRows` array
// - writes record `values` for assertions
// - beforeEach resets the recordings
```

### SCHEMA_TEST (introspection)
```ts
// SOURCE: src/db/schema.test.ts:34-40
it('makes the metric model additive on live sets (non-null, defaulted)', () => {
  const cols = getTableColumns(sets)
  expect(cols.metricMode.notNull).toBe(true)
  expect(cols.metricMode.hasDefault).toBe(true)
})
```

### HAND_EDITED_MIGRATION
```sql
-- SOURCE: drizzle/0004_glamorous_vin_gonzales.sql:4
-- DEFERRABLE INITIALLY DEFERRED (hand-edited; drizzle-kit can't emit it, same as ...)
```
Convention: run `npm run db:generate`, then hand-edit the emitted SQL with commented rationale where drizzle-kit can't express something.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/custom-exercise-input.ts` | CREATE | Zod validation boundary: source enum, category enum, custom-exercise input schema |
| `src/lib/custom-exercise-input.test.ts` | CREATE | Boundary tests |
| `src/db/schema.ts` | UPDATE | `customExercises` table; `source` + CHECK on `workoutExercises`/`programExercises` |
| `src/db/schema.test.ts` | UPDATE | Introspection tests for the new table/columns |
| `drizzle/0006_*.sql` | CREATE (generated + hand-edit) | Table, columns, negative-ID guard DO block |
| `src/db/custom-exercises.ts` | CREATE | User-scoped CRUD: create / update / list (no delete) |
| `src/db/custom-exercises.test.ts` | CREATE | Recording-stub CRUD tests |
| `.claude/PRPs/prds/custom-exercises.prd.md` | UPDATE | Phase 1 → complete after implementation |

## NOT Building

- No delete for custom exercises (PRD: create + edit only in v1)
- No query-site widening (`getLastPerformance`, history, stats, instantiation) — Phase 2
- No catalog merge / `searchExercises` changes — Phase 3
- No MCP tools or input-schema `source` args — Phase 4
- No `wgerExerciseId` column rename (decision #3)
- No free-text categories, no muscle-name enum (only category is enforced)
- No `program_exercise_muscles` changes — that table is untouched this phase

---

## Step-by-Step Tasks

### Task 1: Input validation module
- **ACTION**: Create `src/lib/custom-exercise-input.ts`
- **IMPLEMENT**:
  ```ts
  export const EXERCISE_CATEGORIES = ['Abs','Arms','Back','Calves','Cardio','Chest','Legs','Shoulders'] as const
  export const exerciseSourceSchema = z.enum(['wger', 'custom'])
  export const exerciseCategorySchema = z.enum(EXERCISE_CATEGORIES)
  export const customExerciseInputSchema = z.object({
    name: z.string().trim().min(1).max(MAX_NAME),          // MAX_NAME = 200, mirror program-input.ts:22
    category: exerciseCategorySchema,
    equipment: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
    muscles: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    musclesSecondary: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  }).strict()
  export type ExerciseSource = z.infer<typeof exerciseSourceSchema>
  export type ExerciseCategory = z.infer<typeof exerciseCategorySchema>
  export type CustomExerciseInput = z.infer<typeof customExerciseInputSchema>
  export function parseCustomExerciseInput(input: unknown): CustomExerciseInput { ... }
  ```
  Module doc comment explaining: category is wger's fixed set so merged filtering stays coherent (PRD decision); muscles are free-text wger English names by convention; the app-side parity target is the `Exercise` shape in `src/lib/wger.ts:38-47`.
- **MIRROR**: ZOD_ENUM_AND_PARSE_BOUNDARY (`src/lib/program-input.ts`)
- **IMPORTS**: `import { z } from 'zod'` (zod 4 — same as program-input.ts)
- **GOTCHA**: `MAX_NAME` is module-local in program-input.ts (not exported) — redeclare the constant with the same mirror comment they use for `workout-input` bounds. Use `.strict()` so typos like `musclesPrimary` fail loudly.
- **VALIDATE**: `npx tsc --noEmit`

### Task 2: Input validation tests
- **ACTION**: Create `src/lib/custom-exercise-input.test.ts`
- **IMPLEMENT**: Cases — valid full input parses and trims name; name-only + category input parses (optionals omitted); rejects: empty name, unknown category (e.g. `'Glutes'`), non-array muscles, unknown key (strict), name > 200 chars; category is case-sensitive exact (`'chest'` rejected).
- **MIRROR**: AAA test structure per `src/lib/program-input.test.ts` naming style
- **IMPORTS**: `import { describe, it, expect } from 'vitest'`
- **VALIDATE**: `npm test -- src/lib/custom-exercise-input.test.ts`

### Task 3: Schema — `custom_exercises` table + `source` discriminator
- **ACTION**: Update `src/db/schema.ts`
- **IMPLEMENT**:
  1. New table (place after `userPreferences`, before the programs block, with a doc comment explaining: per-user custom catalog with app-side wger parity; integer identity PK because exercise refs are integer; arrays not child rows because this is catalog data nothing aggregates over — contrast with `program_exercise_muscles`):
  ```ts
  export const customExercises = pgTable(
    'custom_exercises',
    {
      id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
      userId: text('user_id').notNull(), // Clerk user id — ownership root, like `workouts`/`programs`
      name: text('name').notNull(),
      category: text('category').$type<ExerciseCategory>().notNull(), // wger's fixed 8-category set, enforced at the input boundary
      equipment: text('equipment').array(),
      muscles: text('muscles').array(),           // primary muscles, wger English names
      musclesSecondary: text('muscles_secondary').array(),
      createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => [
      index('custom_exercises_user_id_idx').on(t.userId),
      unique('custom_exercises_user_name_unique').on(t.userId, t.name),
    ],
  )
  ```
  2. On `workoutExercises` and `programExercises`, after `wgerExerciseId`:
  ```ts
  // 'wger' | 'custom' — exercise identity is the composite (source, id). When
  // source = 'custom', wgerExerciseId holds a custom_exercises.id (the column
  // name is historical; kept to avoid a rename across every query site).
  source: text('source').$type<ExerciseSource>().notNull().default('wger'),
  ```
  3. Add `check('workout_exercises_wger_id_positive', sql`${t.wgerExerciseId} > 0`)` (and the program twin) to each table's third-argument array — the durable kill for the negative-ID stopgap. Update the `wgerExerciseId` line comments on both tables.
- **MIRROR**: TABLE_DEFINITION + APP_LEVEL_ENUM_COLUMN
- **IMPORTS**: add `check` to the `drizzle-orm/pg-core` import, `sql` from `drizzle-orm`, and `import type { ExerciseSource, ExerciseCategory } from '@/lib/custom-exercise-input'`
- **GOTCHA**: schema.ts already imports types from `@/lib/program-input` — type-only imports from lib into schema are the established pattern. No `relations()` needed for `customExercises` (nothing joins it via drizzle relations yet). Don't touch `program_exercise_muscles`.
- **VALIDATE**: `npx tsc --noEmit && npm test -- src/db/schema.test.ts`

### Task 4: Schema tests
- **ACTION**: Update `src/db/schema.test.ts`
- **IMPLEMENT**: New `it` blocks — `custom_exercises` table name is snake_case; `id` column is integer identity (assert `getTableColumns(customExercises).id.generated` truthy or `dataType === 'number'`); `userId`/`name`/`category` non-null; muscle/equipment arrays nullable; `(user_id, name)` unique via `getTableConfig`; `source` on both ref tables is non-null **and** defaulted (`hasDefault` — the additive-column invariant, mirroring the metricMode test); both ref tables carry a positive-id check constraint (`getTableConfig(...).checks` length ≥ 1).
- **MIRROR**: SCHEMA_TEST
- **VALIDATE**: `npm test -- src/db/schema.test.ts`

### Task 5: Migration — generate + hand-edit
- **ACTION**: `npm run db:generate`, then hand-edit the emitted `drizzle/0006_*.sql`
- **IMPLEMENT**: drizzle-kit emits: CREATE TABLE `custom_exercises`, two `ADD COLUMN "source" ... DEFAULT 'wger' NOT NULL`, two CHECK constraints. Hand-append (with comment, per convention) the stopgap guard:
  ```sql
  --> statement-breakpoint
  -- Negative-ID stopgap guard (hand-edited): the spike's negative-ID convention
  -- was cleaned up and zero rows exist (verified 2026-07-04). A real backfill
  -- can't synthesize a valid category, so if this ever fires, migrate the rows
  -- by hand into custom_exercises first. The CHECK constraints above make new
  -- negative refs impossible.
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM "workout_exercises" WHERE "wger_exercise_id" <= 0)
       OR EXISTS (SELECT 1 FROM "program_exercises" WHERE "wger_exercise_id" <= 0) THEN
      RAISE EXCEPTION 'negative/zero wger_exercise_id rows exist; backfill them into custom_exercises before migrating';
    END IF;
  END $$;
  ```
- **MIRROR**: HAND_EDITED_MIGRATION comment convention
- **GOTCHA**: drizzle-kit adds CHECK constraints via `ALTER TABLE ... ADD CONSTRAINT ... CHECK` which validates existing rows itself — the DO block is belt-and-braces with a clearer error message. Do NOT run `db:push` (it bypasses the migration file); migrations run against `DATABASE_URL_DIRECT` (5432), not the 6543 pooler.
- **VALIDATE**: file exists; `drizzle/meta/_journal.json` gained idx 6 (apply happens in Task 8)

### Task 6: CRUD module
- **ACTION**: Create `src/db/custom-exercises.ts`
- **IMPLEMENT**:
  ```ts
  import { and, asc, eq } from 'drizzle-orm'
  import type { CustomExerciseInput } from '@/lib/custom-exercise-input'
  import { db } from './index'
  import { customExercises } from './schema'

  /** module doc comment — auth boundary, mirroring db/programs.ts:26-35 */

  /** Row type for consumers (Phase 3 catalog merge maps this to `Exercise`). */
  export type CustomExerciseRow = typeof customExercises.$inferSelect

  /** Lists a user's custom exercises, alphabetical by name. */
  export function listCustomExercises(userId: string) {
    return db.select().from(customExercises)
      .where(eq(customExercises.userId, userId))
      .orderBy(asc(customExercises.name))
  }

  /** Creates a custom exercise for the user; returns the new row (incl. its id). */
  export async function createCustomExercise(userId: string, input: CustomExerciseInput): Promise<CustomExerciseRow> {
    const [row] = await db.insert(customExercises).values({
      userId,
      name: input.name,
      category: input.category,
      equipment: input.equipment ?? null,
      muscles: input.muscles ?? null,
      musclesSecondary: input.musclesSecondary ?? null,
    }).returning()
    return row
  }

  /** Full-field update, gated on ownership via update…returning. Null = not owned/found. */
  export async function updateCustomExercise(userId: string, id: number, input: CustomExerciseInput): Promise<CustomExerciseRow | null> {
    const [owned] = await db.update(customExercises)
      .set({ /* all 5 input fields */, updatedAt: new Date() })
      .where(and(eq(customExercises.id, id), eq(customExercises.userId, userId)))
      .returning()
    return owned ?? null
  }
  ```
  Update takes the full validated input (full-field replace, like `updateProgram`'s metadata) — partial patch semantics are a Phase 4 concern if the MCP tool wants them.
- **MIRROR**: DB_MODULE_DOC_COMMENT + OWNERSHIP_GATED_UPDATE + LIST_QUERY
- **GOTCHA**: callers pass **already-parsed** `CustomExerciseInput` (validation happens at the boundary — route/MCP layer — same as `saveProgram(userId, input: ProgramInput)`). The `(user_id, name)` unique means a duplicate create throws a postgres error — let it propagate (MCP error mapping is Phase 4's job). `id` is `number` here, not uuid string — the one intentional difference from programs.
- **VALIDATE**: `npx tsc --noEmit`

### Task 7: CRUD tests
- **ACTION**: Create `src/db/custom-exercises.test.ts`
- **IMPLEMENT**: Recording-stub mock of `./index` (chainable builders):
  - `listCustomExercises` — select builder resolves controllable rows; assert it returns them.
  - `createCustomExercise` — records `values(v)`; assert userId stamped, optionals default to null, returns the returning-row.
  - `updateCustomExercise` — records `set(v)`; returning `[row]` → returns row; returning `[]` → returns null (not-owned gate); assert `updatedAt` refreshed (instanceof Date).
- **MIRROR**: TEST_STRUCTURE (`src/db/preferences.test.ts`) — builder shape differs slightly (`insert().values().returning()`, `update().set().where().returning()`); mirror the recording approach, not the exact builders.
- **VALIDATE**: `npm test -- src/db/custom-exercises.test.ts`

### Task 8: Apply migration + full validation
- **ACTION**: `npm run db:migrate`, then the full validation ladder (below)
- **GOTCHA**: needs `DATABASE_URL_DIRECT` in `.env.local` (drizzle.config.ts reads it; the 6543 transaction pooler cannot run DDL).
- **VALIDATE**: migration applies clean; verify in DB: `custom_exercises` exists, `source` columns default `'wger'` on existing rows, CHECKs present.

### Task 9: Update PRD
- **ACTION**: Edit `.claude/PRPs/prds/custom-exercises.prd.md` phase table: Phase 1 status → `complete`, PRP column → this plan's path. Also check off the two resolved open questions (ID space, muscle storage) with one-line resolutions.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| parse valid input | full 5-field input | normalized object, name trimmed | |
| parse minimal input | name + category only | parses; optionals undefined | |
| reject bad category | `category: 'Glutes'` | ZodError | yes |
| reject empty name | `name: '  '` | ZodError (trim then min) | yes |
| reject unknown key | `{ ..., foo: 1 }` | ZodError (strict) | yes |
| schema introspection | — | table/column/unique/check shapes as specified | |
| create stamps owner | `createCustomExercise(USER, input)` | insert values include `userId: USER`, nulls for omitted optionals | |
| update gates ownership | returning `[]` | `null`, nothing else | yes |
| list scopes to user | — | where user_id filter, ordered by name | |

### Edge Cases Checklist
- [x] Empty input (empty name, empty arrays)
- [x] Maximum size input (name 200, array caps)
- [x] Invalid types (non-array muscles, unknown category)
- [ ] Concurrent access — N/A this phase (unique (user_id,name) is the only race guard needed)
- [ ] Network failure — N/A (no network in this phase)
- [x] Permission denied (update on non-owned id → null)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npm run lint
```
EXPECT: zero errors

### Unit Tests (affected)
```bash
npm test -- src/lib/custom-exercise-input.test.ts src/db/custom-exercises.test.ts src/db/schema.test.ts
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: no regressions (the `source` column is additive+defaulted; existing insert paths omit it safely)

### Database Validation
```bash
npm run db:generate   # during Task 5 — emits 0006
npm run db:migrate    # Task 8 — applies clean
```
EXPECT: migration idx 6 applied; guard DO block passes (zero negative rows)

### Build
```bash
npm run build
```
EXPECT: clean production build

### Manual Validation
- [ ] `drizzle/0006_*.sql` contains: CREATE TABLE, 2× ADD COLUMN source, 2× CHECK, hand-edited DO guard with comment
- [ ] Existing `workout_exercises` rows show `source = 'wger'` after migrate

---

## Acceptance Criteria
- [ ] `custom_exercises` table exists with integer identity PK, user ownership, parity columns
- [ ] `source` discriminator (default `'wger'`) on both ref tables; negative IDs impossible (CHECK)
- [ ] Migration runs clean including the stopgap guard
- [ ] CRUD module (create/update/list, no delete) follows the auth-boundary conventions; tests green
- [ ] Category enforced to wger's 8-category set at the input boundary
- [ ] All validation commands pass; PRD phase 1 marked complete

## Completion Checklist
- [ ] Code follows discovered patterns (comment style, ownership gates, enum-as-text)
- [ ] Tests follow recording-stub + introspection patterns
- [ ] No hardcoded values beyond the deliberate category constant
- [ ] No scope creep into Phases 2–4 (no query-site or catalog changes)
- [ ] Self-contained — no codebase searching needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| drizzle-kit emits CHECK/identity SQL differently than expected | L | L | Review emitted 0006 before migrating; hand-edit per house convention |
| `generatedAlwaysAsIdentity` blocks explicit-id inserts a future migration might want | L | L | `OVERRIDING SYSTEM VALUE` exists in PG if ever needed; note only |
| Duplicate-name create surfaces as raw PG error | M | L | Acceptable this phase; Phase 4 maps it to a clean MCP error |
| Program-stats plan lands later and conflicts | L | L | Disjoint surfaces; Phase 2 (not this) owns the stats grouping-key widening |

## Notes
- wger category set verified live against `wger.de/api/v2/exercisecategory/` on 2026-07-04 (8 categories).
- The "backfill" is implemented as guard + CHECK (decision #4) because zero negative-ID rows exist — this is a documented deviation from the PRD's literal wording with identical intent.
- `ExerciseSource` lives in `custom-exercise-input.ts` (not `program-input.ts`) because Phases 2–4 thread it through both workout and program surfaces.

**Confidence Score**: 9/10 — additive schema change with every pattern copied from adjacent code; the only novel elements are the identity column and the hand-edited guard block.
