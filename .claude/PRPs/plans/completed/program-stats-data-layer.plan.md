# Plan: Program Stats — Data Layer

## Summary
Create `src/db/program-stats.ts`: a read-only aggregate module that turns program-linked workouts (provenance: `workouts.programDayId` + `workouts.programWeek`) into per-week adherence, per-week volume, and per-exercise progression — all in kg-domain data structures. This is Phase 1 of the program-stats PRD; UI (Phase 2), PRs (Phase 3), and the MCP tool (Phase 4) all consume this module.

## User Story
As a lifter mid-block on a program at one gym, I want progression, adherence, and volume computed per program, so I can tell whether the block is working without cross-gym noise polluting the numbers.

## Problem → Solution
Nothing aggregates workouts by program today (only `nextProgramWeek` peeks at provenance) → one tested module answers "week position, days done vs. planned, sets/tonnage per week, per-lift trend" for a single program, with ad-hoc workouts excluded by construction.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/program-stats.prd.md`
- **PRD Phase**: Phase 1 — Stats data layer
- **Estimated Files**: 2 (1 new module, 1 new test file)

---

## UX Design

N/A — internal change. Data layer only; the Stats tab UI is Phase 2.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/schema.ts` | 16–68, 102–134 | `workouts` provenance columns (`programDayId` SET NULL, `programWeek` 1-based), `sets` shape (nullable reps/weight kg, `completed`, `metricMode`), `programs`/`programDays` shape |
| P0 | `src/db/programs.ts` | 26–44, 292–323 | Module header (auth-boundary doc comment style), `nextProgramWeek` — the exact join pattern (workouts ⨝ programDays on `programDayId`, filtered by `programDays.programId` + `workouts.userId`) this feature generalizes |
| P0 | `src/db/workouts.ts` | 1–49, 92–117 | Import style, flat-select query style (`getExerciseHistoryBefore`), aggregate select style (`listWorkoutSummaries`) |
| P0 | `src/db/last-performance.test.ts` | all | The mocked-db test harness for multi-select functions (chainable, thenable builder + queued results + `PgDialect` where-param introspection) — copy this harness |
| P1 | `src/lib/one-rep-max.ts` | all | `estimate1RM`, `bestSet`, `MAX_RELIABLE_REPS = 12` — reuse, do not reimplement e1RM |
| P1 | `src/db/exercise-history.test.ts` | all | Simpler single-select variant of the same harness; scoping-assertion idiom |
| P2 | `src/lib/units.ts` | all | Confirms kg is canonical storage; this module must NOT convert units (display converts) |
| P2 | `src/app/programs/[id]/page.tsx` | 13–41 | How the Phase-2 consumer will call this (server component, `Promise.all`, `nextProgramWeek`) |

## External Documentation

None needed — feature uses established internal patterns (Drizzle queries + pure TS aggregation, both already exemplified in the repo).

---

## Patterns to Mirror

### MODULE_HEADER / AUTH_BOUNDARY
```ts
// SOURCE: src/db/programs.ts:26-35
/**
 * Data access for training programs, always scoped to a Clerk userId.
 *
 * Like `db/workouts.ts`, this module is the authorization boundary: the app has
 * no Postgres row-level security, so every query filters by `user_id` on the
 * `programs` root and the children inherit ownership through the FK chain ...
 */
```
Every query in the new module must carry `eq(workouts.userId, userId)` (or gate through the `programs` row's `userId`).

### JOIN_THROUGH_PROGRAM_DAYS (the provenance join)
```ts
// SOURCE: src/db/programs.ts:297-302 (nextProgramWeek)
const [agg] = await db
  .select({ current: max(workouts.programWeek) })
  .from(workouts)
  .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
  .where(and(eq(programDays.programId, programId), eq(workouts.userId, userId)))
```
Workouts carry `programDayId` but **not** `programId` — stats always join through `programDays`.

### FLAT_SELECT_STYLE
```ts
// SOURCE: src/db/workouts.ts:101-117 (getExerciseHistoryBefore)
return db
  .select({
    wgerExerciseId: workoutExercises.wgerExerciseId,
    reps: sets.reps,
    weight: sets.weight,
  })
  .from(sets)
  .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
  .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
  .where(and(eq(workouts.userId, userId), ...))
```

### OWNERSHIP_RETURNS_NULL (error handling)
```ts
// SOURCE: src/db/programs.ts:277 (getProgramDayDetail)
if (!day || day.program.userId !== userId) return null
```
DB modules never throw for not-found/not-owned — they return `null` and the caller (page → `notFound()`, MCP tool → error result) translates. No logging in `src/db/` modules; comments carry the caveats.

### E1RM_REUSE
```ts
// SOURCE: src/lib/one-rep-max.ts:28-40
export function bestSet(
  sets: readonly { reps: number | null; weight: number | null }[],
): BestSet | null { ... }
```
`bestSet` already null-skips sets missing reps or weight — feed it raw week rows.

### TEST_STRUCTURE (mocked multi-select db)
```ts
// SOURCE: src/db/last-performance.test.ts:13-41
let selectResults: unknown[][] = []
let selectCount = 0
const whereArgs: unknown[] = []

function makeBuilder() {
  selectCount += 1
  const rows = nextRows()
  const builder: Record<string, unknown> = {
    from: () => builder,
    innerJoin: () => builder,
    where: (cond: unknown) => { whereArgs.push(cond); return builder },
    orderBy: () => builder,
    limit: () => Promise.resolve(rows),
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  }
  return builder
}
vi.mock('./index', () => ({ db: { select: () => makeBuilder() } }))
```
Add `leftJoin: () => builder` to the builder (this module uses left joins). Scoping assertions use `new PgDialect().sqlToQuery(whereArgs[0] as SQL).params` (see `exercise-history.test.ts:75-88`).

### DOC_COMMENT_DENSITY
Exported functions get `/** ... */` JSDoc explaining semantics and edge decisions (see any function in `workouts.ts`/`programs.ts`). Inline comments state constraints (e.g. the deleted-day provenance caveat), not narration.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/program-stats.ts` | CREATE | The Phase-1 aggregate module (queries + pure aggregation + types) |
| `src/db/program-stats.test.ts` | CREATE | TDD coverage: pure aggregation cases + query-scoping assertions |
| `.claude/PRPs/prds/program-stats.prd.md` | UPDATE | Phase 1 status → in-progress, PRP link (done by this planning pass) |

## NOT Building

- Stats UI / Stats tab (Phase 2)
- Program PRs (baseline → best e1RM) (Phase 3) — but the flat row shape must not preclude it
- MCP `get_program_stats` tool (Phase 4)
- Unit conversion — output stays kg; display converts via `src/lib/units.ts`
- Gym/equipment entities, changes to `getLastPerformance`, retro-linking ad-hoc workouts, schema changes of any kind (success metric: 0 migrations)
- Charting/derived-display formatting (weeks-as-labels etc. is UI concern)

---

## Design (module contract)

All weights kg. All weeks 1-based. Ad-hoc workouts (null `programDayId`) never appear — the inner join through `programDays` excludes them by construction.

```ts
export interface ProgramWeekStats {
  week: number
  /** Distinct program days with a workout STARTED this week (PRD: started counts). */
  daysStarted: number
  /** Subset of daysStarted whose workout has completedAt set — UI flags the gap. */
  daysCompleted: number
  /** Planned days = count of the program's days (same denominator every week). */
  plannedDays: number
  /** Sets with completed = true this week (all metric modes — sets always count). */
  completedSets: number
  /** Σ reps × weight over completed reps_weight sets with BOTH reps and weight
   *  non-null (PRD: tonnage skips null-weight sets — maxed stack machines). */
  tonnageKg: number
}

export interface ExerciseWeekPoint {
  week: number
  /** Highest-e1RM completed set this week (null = exercise not trained / nothing loggable). */
  best: BestSet | null   // re-exported shape from '@/lib/one-rep-max'
  completedSets: number
}

export interface ProgramExerciseProgression {
  wgerExerciseId: number
  name: string   // denormalized name from workout_exercises (latest occurrence wins)
  weeks: ExerciseWeekPoint[]  // sparse: only weeks the exercise appeared in
}

export interface ProgramStats {
  program: { id: string; name: string; status: string; mesocycleWeeks: number; deloadWeek: number | null }
  currentWeek: number                     // via existing nextProgramWeek()
  /** Index 0 = week 1. Length = max(mesocycleWeeks, highest observed week) so a
   *  manually-overshot week still shows rather than silently dropping. */
  weeks: ProgramWeekStats[]
  exercises: ProgramExerciseProgression[] // ordered by first appearance (week, then position)
}

/** Null when the program doesn't exist or isn't owned by the user. */
export async function getProgramStats(userId: string, programId: string): Promise<ProgramStats | null>

/** Pure aggregation over flat rows — exported for tests. */
export function aggregateProgramStats(
  program: ProgramStats['program'],
  plannedDays: number,
  currentWeek: number,
  rows: ProgramStatsRow[],
): ProgramStats
```

`ProgramStatsRow` (the flat query shape — one row per set, or per workout when it has no sets, via left joins):

```ts
export interface ProgramStatsRow {
  workoutId: string
  programDayId: string
  programWeek: number | null      // guard: skip rows with null week (shouldn't occur via instantiation)
  completedAt: Date | null
  wgerExerciseId: number | null   // null when the workout has no exercises (left join)
  exerciseName: string | null
  reps: number | null
  weight: number | null           // kg
  completed: boolean | null
  metricMode: string | null
}
```

### Semantics decisions (locked by PRD)
1. **Adherence**: a day counts as "started" from `daysStarted` (distinct `programDayId` per week); incomplete (`completedAt` null) is surfaced via `daysCompleted`, not excluded. (PRD open question v1 answer.)
2. **Tonnage**: only `completed = true`, `metricMode = 'reps_weight'`, reps ≠ null, weight ≠ null. Sets with null weight still count in `completedSets`. (PRD open question v1 answer.)
3. **Progression `best`**: `bestSet()` over that week's **completed** sets — instantiated-but-unlogged sets carry seeded `weight` with `reps = null`, and `bestSet` needs both, but filtering on `completed` also excludes a half-logged set the user abandoned. Filter `completed = true` first, then `bestSet`.
4. **plannedDays denominator**: current count of `program_days`. Editing days mid-block shifts history's denominator — acceptable POC drift; note in a comment.
5. **Deleted-day dropout**: workouts whose `programDayId` was SET NULL by a day deletion (or full-replace `upsert_program`) silently vanish from stats. REQUIRED code comment on the join (PRD: "worth a code comment").

### getProgramStats orchestration (4 reads, no transaction — read-only)
1. Program row: `select id,name,status,mesocycleWeeks,deloadWeek from programs where id AND userId` → `null` if absent (ownership gate, `OWNERSHIP_RETURNS_NULL`).
2. Planned days: `select count(programDays.id) ... where programId` (mirror `programs.ts:305-308`).
3. `currentWeek = await nextProgramWeek(userId, programId, program.mesocycleWeeks)` — import, don't duplicate.
4. Flat rows: `from(workouts) innerJoin(programDays, eq(programDays.id, workouts.programDayId)) leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id)) leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id)) where(and(eq(programDays.programId, programId), eq(workouts.userId, userId)))` — left joins so a started-but-empty workout still counts toward adherence.

Then `aggregateProgramStats(...)` — all counting/summing/bestSet logic is pure TS (immutable: build new maps/arrays, no in-place mutation of inputs).

---

## Step-by-Step Tasks

### Task 1: Write the failing test file (RED)
- **ACTION**: Create `src/db/program-stats.test.ts` before the module exists.
- **IMPLEMENT**: Two describe blocks:
  - `describe('aggregateProgramStats')` — pure-function cases, no mocking (table in Testing Strategy below).
  - `describe('getProgramStats')` — mocked-db harness: copy `last-performance.test.ts:13-41` builder verbatim, **add `leftJoin: () => builder`**. Mock `./programs` too: `vi.mock('./programs', () => ({ nextProgramWeek: vi.fn().mockResolvedValue(2) }))` so the test controls `currentWeek` without queueing its internal selects. Queue results in call order: [programRow], [dayCount], [flatRows].
- **MIRROR**: TEST_STRUCTURE pattern; scoping assertion idiom from `exercise-history.test.ts:75-88` (`PgDialect().sqlToQuery(whereArgs[n] as SQL).params` contains `USER` and the program id).
- **IMPORTS**: `import { describe, it, expect, vi, beforeEach } from 'vitest'`; `import type { SQL } from 'drizzle-orm'`; `import { PgDialect } from 'drizzle-orm/pg-core'`; module import AFTER `vi.mock` calls (hoisting handles it — match existing files' layout).
- **GOTCHA**: `vi.mock('./index', ...)` path is relative to the TEST file (both live in `src/db/`). The builder counts EVERY `db.select()` — `getProgramStats` issues 3 (program, dayCount, flatRows) once `nextProgramWeek` is mocked out.
- **VALIDATE**: `npm test -- src/db/program-stats.test.ts` → fails with module-not-found (RED confirmed).

### Task 2: Create `src/db/program-stats.ts` — types + pure aggregation (GREEN part 1)
- **ACTION**: Write the module header doc comment (auth-boundary paragraph, MIRROR `programs.ts:26-35`), the interfaces from the Design section, and `aggregateProgramStats`.
- **IMPLEMENT**:
  - Skip rows with `programWeek == null` (defensive guard; comment why).
  - Weeks array: `length = Math.max(mesocycleWeeks, maxObservedWeek)`, every entry materialized (zeroed) so sparse blocks render as explicit gaps, not missing indices.
  - Adherence: per week, `Set` of `programDayId` for daysStarted; distinct workouts with `completedAt != null` → count distinct `programDayId` for daysCompleted (a day started twice, completed once → completed).
  - Volume: per Semantics decision 2.
  - Progression: group by `wgerExerciseId`; name = last non-null `exerciseName` seen; per-week points only for weeks with ≥1 row for that exercise (sparse); `best` per Semantics decision 3 using imported `bestSet`.
  - Order `exercises` by first appearance (lowest week first; stable within week by input order).
- **MIRROR**: E1RM_REUSE; DOC_COMMENT_DENSITY; immutability (build fresh structures — never mutate inputs).
- **IMPORTS**: `import { bestSet, type BestSet } from '@/lib/one-rep-max'` (re-export `BestSet` if consumers need it).
- **GOTCHA**: `bestSet` returns full-precision e1RM — do NOT round here (display rounds; see `one-rep-max.ts:20`). Do not convert kg→lb anywhere in this module.
- **VALIDATE**: `npm test -- src/db/program-stats.test.ts` → pure-aggregation block green.

### Task 3: Add the queries + `getProgramStats` (GREEN part 2)
- **ACTION**: Implement the 4-read orchestration from the Design section.
- **IMPLEMENT**:
  ```ts
  import { and, asc, count, eq } from 'drizzle-orm'
  import { db } from './index'
  import { nextProgramWeek } from './programs'
  import { programs, programDays, workouts, workoutExercises, sets } from './schema'
  ```
  - Read 1 (ownership gate): `.select({...cols}).from(programs).where(and(eq(programs.id, programId), eq(programs.userId, userId)))` → destructure `[program]`; `if (!program) return null`.
  - Read 2: `.select({ value: count(programDays.id) }).from(programDays).where(eq(programDays.programId, programId))` — MIRROR `programs.ts:305-308` exactly.
  - Read 3: `nextProgramWeek(userId, programId, program.mesocycleWeeks)`.
  - Read 4 (flat rows): workouts → innerJoin programDays → leftJoin workoutExercises → leftJoin sets, selecting the `ProgramStatsRow` columns, `orderBy(asc(workouts.startedAt), asc(workoutExercises.position), asc(sets.setNumber))` (deterministic input order for "first appearance" / tie-breaks).
  - **REQUIRED comment** on the innerJoin: workouts orphaned by day deletion / full-replace program edits (`programDayId` SET NULL) drop out of stats silently — accepted POC trade-off (PRD risk #1).
- **MIRROR**: JOIN_THROUGH_PROGRAM_DAYS; FLAT_SELECT_STYLE; OWNERSHIP_RETURNS_NULL.
- **GOTCHA**: Do NOT join `from(sets)` upward like `getExerciseHistoryBefore` — that inner-join direction would drop empty workouts and break adherence. Start `from(workouts)`.
- **VALIDATE**: `npm test -- src/db/program-stats.test.ts` → all green, including scoping assertions.

### Task 4: Refactor pass + full validation (IMPROVE)
- **ACTION**: Re-read the module against the checklists; extract per-week accumulator helpers if `aggregateProgramStats` exceeds ~50 lines; confirm comment density matches `programs.ts`.
- **VALIDATE**: run the full suite + lint + typecheck (commands below). Confirm no existing test changed — success metric "`getLastPerformance` behavior unchanged / existing tests still green".

---

## Testing Strategy

### Unit Tests — `aggregateProgramStats` (pure, no mocks)

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| empty block | no rows, mesocycleWeeks 7, plannedDays 5 | 7 zeroed weeks, `exercises: []` | ✓ (PRD sparse-data risk) |
| single-week happy path | wk1: 2 days started, 1 completed, completed sets w/ reps+weight | daysStarted 2, daysCompleted 1, tonnage = Σ reps×weight | |
| multi-week progression | bench wk1 100×8, wk2 102.5×8 (completed) | exercise week points with rising `best.e1rm` | |
| null-weight machine sets | completed set reps 8, weight null | counted in completedSets, excluded from tonnage, `best` null if no loadable set | ✓ (PRD open Q) |
| uncompleted seeded sets | rows completed=false, weight seeded, reps null | completedSets 0, tonnage 0, `best` null | ✓ |
| started-not-completed day | workout row (no sets via left join: null set cols), completedAt null | daysStarted 1, daysCompleted 0 | ✓ (PRD open Q) |
| duration-mode sets | completed set metricMode 'duration', durationSec set | counts in completedSets, no tonnage | ✓ |
| week beyond mesocycle | row with programWeek 8, mesocycleWeeks 7 | weeks array length 8 | ✓ |
| null programWeek row | one row programWeek null | row ignored, no crash | ✓ |
| same day twice in a week | two workouts, same programDayId, same week | daysStarted 1 (distinct) | ✓ |

### Unit Tests — `getProgramStats` (mocked db)

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| not owned / missing program | queue `[[]]` for read 1 | `null`, `selectCount === 1` (later reads skipped) | ✓ |
| happy path wiring | queued program row, dayCount, flat rows | assembled `ProgramStats` with mocked `currentWeek` | |
| scoping | inspect `whereArgs` | read-1 params contain userId+programId; read-4 params contain userId+programId | ✓ (auth boundary) |

### Edge Cases Checklist
- [x] Empty input (empty block)
- [x] Null weights / null reps / null programWeek
- [x] Ad-hoc workouts excluded — by construction (inner join); asserted implicitly via scoping test
- [ ] Concurrent access — N/A, read-only
- [ ] Network failure — N/A, db errors propagate like every other db module

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npm run lint
```
EXPECT: zero type errors, zero lint errors

### Unit Tests (affected area)
```bash
npm test -- src/db/program-stats.test.ts
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: no regressions (esp. `last-performance.test.ts`, `exercise-history.test.ts`, `instantiate-program.test.ts` untouched and green)

### Build
```bash
npm run build
```
EXPECT: clean production build

### Database Validation
N/A — zero schema changes (PRD success metric). No new migration files should exist in `drizzle/`.

### Manual Validation
- [ ] `git diff --stat` shows only the 2 new files (+ PRD status edit)

---

## Acceptance Criteria
- [ ] All 4 tasks completed, TDD order respected (test file written failing-first)
- [ ] All validation commands pass
- [ ] Test matrix above covered (PRD success signal: "multi-week, sparse, null-weight, and ad-hoc-workout-excluded cases")
- [ ] Output is kg-domain only; no unit conversion inside the module
- [ ] Deleted-day dropout comment present on the provenance join

## Completion Checklist
- [ ] Module header carries the auth-boundary paragraph
- [ ] Errors: `null` for not-owned, no throws/logging (matches `src/db/` style)
- [ ] `bestSet`/`estimate1RM` imported, not reimplemented
- [ ] No mutation (fresh structures in aggregation)
- [ ] No hardcoded values (weeks derived from `mesocycleWeeks` + observed data)
- [ ] PRD phase table updated when implementation lands (status → complete)
- [ ] Self-contained — no codebase searching needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Provenance loss via full-replace program edit orphans workouts mid-block | H | Stats undercount silently | Comment on the join (this plan); denormalizing `programId` onto workouts is explicitly deferred |
| Left-join fan-out miscounts (set rows duplicate workout cols) | M | Wrong adherence numbers | Aggregate with distinct-by-`workoutId`/`programDayId` sets in pure TS, covered by "same day twice" test |
| `plannedDays` denominator drifts if days edited mid-block | L | Adherence % shifts retroactively | Accepted POC behavior; documented in code comment |

## Notes
- `currentWeek` deliberately reuses `nextProgramWeek` rather than re-deriving from the stats rows so the Stats view and the Start-day button always agree on the week.
- `MAX_RELIABLE_REPS` labeling is a display concern — Phase 2 imports it; the data layer returns raw `BestSet` (reps included) so the UI can decide when to show "Est.".
- Phase 3 (PRs) will extend this module: the sparse per-exercise week points already contain first-week baseline and best e1RM, so PRs become a pure derivation over `ProgramExerciseProgression` — no query changes anticipated.
