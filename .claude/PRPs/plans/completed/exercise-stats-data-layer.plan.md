# Plan: Exercise Stats — Phase 1: Data Layer

## Summary
Build `src/db/exercise-stats.ts`: an all-time, per-exercise stats module (records, per-session e1RM trend, paginated session history) keyed on the composite exercise identity, plus the `(wger_exercise_id, source)` index migration. Pure aggregation exported for tests, following the `program-stats.ts` pattern exactly. No UI in this phase.

## User Story
As the app's lifter, I want my all-time records and trend for any exercise computed correctly across every completed workout, so that the sheet, detail page, and PR detection (Phases 2–4) all read from one trustworthy source.

## Problem → Solution
Exercise performance queries exist only block-scoped (`program-stats.ts`) or single-lookback (`getLastPerformance`) → one module answers "all-time records / trend / history" for one exercise, completed-only, logging-type-aware, composite-identity-safe.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/exercise-stats.prd.md`
- **PRD Phase**: 1 — Data layer
- **Estimated Files**: 4 (schema.ts, new module, new test, generated migration)

---

## UX Design

N/A — internal change. UI lands in Phases 2–3.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/one-rep-max.ts` | all (121) | The scorer IS this file — `bestScoredSet`, `effectiveLoadKg`, `estimate1RM`. Already shared; do NOT re-derive or extract anything |
| P0 | `src/db/program-stats.ts` | 1–130, 186–260, 285–348 | The module template: authz-boundary doc comment, flat-row interface, pure `aggregate*` exported for tests, `Promise.all` reads, composite-key grouping |
| P0 | `src/db/schema.ts` | 40–89 | `workout_exercises` + `sets` columns; where the new index goes |
| P1 | `src/db/program-stats.test.ts` | 1–60 | The mocked-db harness to mirror (queued thenable builders + PgDialect where-introspection) |
| P1 | `src/db/workouts.ts` | 62–133 | `getLastPerformance` / `getExerciseHistoryBefore` — nearest exercise-first queries; note both LACK source + completed filters (see GOTCHAs) |
| P2 | `src/db/preferences.ts` | `getBodyweightKg` | Bodyweight read for scoring, same as program-stats |
| P2 | `drizzle/0013_minor_apocalypse.sql` | all | What a generated index migration looks like |

## External Documentation

None needed — feature uses established internal patterns (Drizzle select/joins, vitest mocked-db harness).

---

## Patterns to Mirror

### MODULE_DOC + AUTHZ_BOUNDARY
```ts
// SOURCE: src/db/program-stats.ts:10-25
/**
 * Read-only aggregates for ONE program's workout history, always scoped to a
 * Clerk userId.
 *
 * Like `db/workouts.ts`, this module sits on the authorization boundary: the
 * app has no Postgres row-level security, so ... the flat-rows query filters
 * by `user_id` ... All weights stay canonical kg — display converts, this
 * module never does.
 */
```

### FLAT_ROW_INTERFACE + PURE_AGGREGATE
```ts
// SOURCE: src/db/program-stats.ts:107-137
export interface ProgramStatsRow { workoutId: string; /* ... */ weight: number | null /* kg */ }
/** Pure aggregation over the flat rows — exported for tests. Builds fresh
 *  structures throughout; never mutates its inputs. */
export function aggregateProgramStats(/* ... */, rows: readonly ProgramStatsRow[], bodyweightKg: number | null = null)
```

### SCORING (use as-is, never read raw weight)
```ts
// SOURCE: src/db/program-stats.ts:244-247 — completed sets only, then score
const completedRows = weekRows.filter((r) => r.completed === true)
best: bestScoredSet(completedRows, acc.loggingType, bodyweightKg),
// SOURCE: src/lib/one-rep-max.ts:93-97
export function bestScoredSet(sets, loggingType, bodyweightKg): ScoredBestSet | null
```

### STRICTLY_GREATER_TIES
```ts
// SOURCE: src/db/program-stats.ts:275 — ties keep the EARLIEST occurrence
if (best === null || candidate.e1rm > best.e1rm) best = candidate
```

### TONNAGE_RULE (session volume)
```ts
// SOURCE: src/db/program-stats.ts:165-167 — reps_weight only, both non-null
if (row.metricMode === 'reps_weight' && row.reps !== null && row.weight !== null) {
  tonnage.set(week, (tonnage.get(week) ?? 0) + row.reps * row.weight)
}
```

### PARALLEL_READS + QUERY_SHAPE
```ts
// SOURCE: src/db/program-stats.ts:304-340
const [..., bodyweightKg, rows] = await Promise.all([
  /* ... */ getBodyweightKg(userId),
  db.select({ /* flat columns */ })
    .from(workouts)
    .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
    .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
    .where(and(/* userId scope */))
    .orderBy(asc(workouts.startedAt), asc(workoutExercises.position), asc(sets.setNumber)),
])
```

### INDEX_DEFINITION
```ts
// SOURCE: src/db/schema.ts:136 — composite index serving filter + sort
(t) => [index('bodyweight_logs_user_id_weighed_at_idx').on(t.userId, t.weighedAt.desc())]
```

### TEST_STRUCTURE (mocked-db harness)
```ts
// SOURCE: src/db/program-stats.test.ts:14-46 — queued thenable builders
let selectResults: unknown[][] = []
function makeBuilder() { /* from/innerJoin/leftJoin/where/orderBy → builder; thenable resolves nextRows() */ }
vi.mock('./index', () => ({ db: { select: () => makeBuilder() } }))
vi.mock('./preferences', () => ({ getBodyweightKg: vi.fn(async () => null) }))
// where-conditions pushed to whereArgs; asserted via PgDialect param introspection
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/schema.ts` | UPDATE | Add `workout_exercises_exercise_idx` on `(wgerExerciseId, source)` — this feature inverts the access path to exercise-first; column currently unindexed |
| `drizzle/00XX_*.sql` (+meta) | CREATE (generated) | `npm run db:generate` output for the index |
| `src/db/exercise-stats.ts` | CREATE | The Phase-1 deliverable (see tasks) |
| `src/db/exercise-stats.test.ts` | CREATE | Pure-aggregation tests across logging types + query-scoping tests |

## NOT Building

- Any UI (sheet, pages) — Phases 2–3
- PR detection logic — Phase 4 (it will consume `records.bestE1rm` from this module)
- Duration/distance records (`duration`/`duration_distance` sets appear in session history rows but produce no records/trend)
- MCP tool exposure — not in the PRD's v1
- Fixing `getLastPerformance` / `getExerciseHistoryBefore`'s missing `source` filter — pre-existing gap, separate concern (noted below)
- Backfilling or altering any existing data

---

## Step-by-Step Tasks

### Task 1: Index migration
- **ACTION**: Add to the `workout_exercises` table config in `src/db/schema.ts`.
- **IMPLEMENT**: Alongside the existing CHECK in the config array:
  `index('workout_exercises_exercise_idx').on(t.wgerExerciseId, t.source)`
  (import `index` is already imported in schema.ts). Then run `npm run db:generate`.
- **MIRROR**: INDEX_DEFINITION.
- **GOTCHA**: Do NOT hand-edit the generated SQL (only DEFERRABLE constraints were ever hand-edited). Do not run `db:migrate` against prod as part of this PR — deploys are manual.
- **VALIDATE**: Generated SQL is a single `CREATE INDEX ... ON "workout_exercises" ("wger_exercise_id","source")`; `npm test` (schema.test.ts) green.

### Task 2: Module skeleton + types (`src/db/exercise-stats.ts`)
- **ACTION**: Create the module with doc comment and exported types.
- **IMPLEMENT**:
  ```ts
  /** Read-only ALL-TIME aggregates for ONE exercise across a user's COMPLETED
   *  workouts... (authz-boundary paragraph; canonical-kg paragraph — mirror
   *  program-stats.ts:10-25). Exercise identity is the composite (source, id). */
  export interface ExerciseStatsRow {
    workoutId: string
    startedAt: Date
    reps: number | null
    weight: number | null // kg
    completed: boolean
    metricMode: string
  }
  export interface ExerciseRecordSet { workoutId: string; performedAt: Date; reps: number; weightKg: number; e1rm: number }
  export interface ExerciseRecords {
    /** All null when nothing is e1rm-scorable (rep-fallback-only history). */
    bestE1rm: ExerciseRecordSet | null
    heaviestLoadKg: ExerciseRecordSet | null   // highest effective load lifted
    mostReps: { workoutId: string; performedAt: Date; reps: number } | null
    bestSessionVolumeKg: { workoutId: string; performedAt: Date; volumeKg: number } | null
  }
  export interface ExerciseTrendPoint { workoutId: string; performedAt: Date; e1rm: number }
  export interface ExerciseAllTimeStats {
    exercise: { wgerExerciseId: number; source: ExerciseSource; name: string; loggingType: LoggingType }
    totalSessions: number
    totalCompletedSets: number
    records: ExerciseRecords
    /** Per-session best e1RM, ascending by session start. Sparse: only
     *  e1rm-scorable sessions appear. */
    trend: ExerciseTrendPoint[]
  }
  ```
- **MIRROR**: MODULE_DOC + FLAT_ROW_INTERFACE.
- **IMPORTS**: `import { and, asc, desc, eq, isNotNull } from 'drizzle-orm'`; `bestScoredSet, effectiveLoadKg, estimate1RM` from `@/lib/one-rep-max`; `ExerciseSource` from `@/lib/custom-exercise-input`; `LoggingType` from `@/lib/workout-input`; `db` from `./index`; `getBodyweightKg` from `./preferences`; tables from `./schema`.
- **GOTCHA**: `weight` semantics vary by `logging_type` — every load number must pass through `effectiveLoadKg`/`bestScoredSet`. Never `row.weight` directly except inside the TONNAGE_RULE (which is raw by definition, reps_weight-gated).
- **VALIDATE**: `npm run lint` clean.

### Task 3: Pure aggregation — `aggregateExerciseStats`
- **ACTION**: Pure function `(rows: readonly ExerciseStatsRow[], loggingType: LoggingType, bodyweightKg: number | null) => { totalSessions; totalCompletedSets; records; trend }`, exported for tests.
- **IMPLEMENT**:
  1. Filter `completed === true` rows; group by `workoutId` preserving input order (rows arrive ascending by `startedAt`, then `setNumber` — mirror the Map-accumulator style of program-stats.ts:150-169).
  2. Per session: `bestScoredSet(sessionRows, loggingType, bodyweightKg)` → if `kind === 'e1rm'`, emit a trend point `{ workoutId, performedAt: startedAt, e1rm }`.
  3. Records, all strictly-greater (earliest occurrence keeps ties):
     - `bestE1rm`: max e1rm across trend points' winning sets.
     - `heaviestLoadKg`: max `effectiveLoadKg(loggingType, row.weight, bodyweightKg)` over reps-≥1 completed reps_weight-mode rows (null-load rows skipped).
     - `mostReps`: max `reps` over completed rows with integer reps ≥ 1 (mirror one-rep-max.ts:114 guard) — any metric mode with reps.
     - `bestSessionVolumeKg`: per-session Σ reps×weight under TONNAGE_RULE; max across sessions; sessions with 0 volume don't compete.
  4. `totalSessions` = distinct workoutIds with ≥1 completed set; `totalCompletedSets` = completed row count.
- **MIRROR**: SCORING, STRICTLY_GREATER_TIES, TONNAGE_RULE; fresh structures, no input mutation.
- **GOTCHA**: Records are gated to `metricMode === 'reps_weight'` rows for load/volume (duration rows have null reps/weight anyway, but gate explicitly — PRD scope). `mostReps` stays independent of the e1rm records: if NO set is e1rm-scorable, `bestE1rm`/`heaviestLoadKg`/trend are null/empty but `mostReps` may still exist (bodyweight-no-BW users).
- **VALIDATE**: Unit tests (Task 5) — this function is where the logging-type matrix lives.

### Task 4: Queries — `getExerciseStats` + `getExerciseSessions`
- **ACTION**: Two exported async functions, both userId-scoped and composite-identity-filtered.
- **IMPLEMENT**:
  ```ts
  export async function getExerciseStats(
    userId: string, source: ExerciseSource, wgerExerciseId: number,
  ): Promise<ExerciseAllTimeStats | null>
  ```
  `Promise.all`: (a) `getBodyweightKg(userId)`; (b) flat rows —
  `db.select({ workoutId, startedAt, reps, weight, completed, metricMode, exerciseName: workoutExercises.name, loggingType: workoutExercises.loggingType })`
  `.from(sets).innerJoin(workoutExercises, ...).innerJoin(workouts, ...)`
  `.where(and(eq(workouts.userId, userId), eq(workoutExercises.wgerExerciseId, wgerExerciseId), eq(workoutExercises.source, source), isNotNull(workouts.completedAt)))`
  `.orderBy(asc(workouts.startedAt), asc(sets.setNumber))`.
  Inner joins (not left): a set row always has its parents; empty result → return null (exercise has no completed history). Latest non-null `name`/`loggingType` wins (program-stats.ts:222-225 rule). Delegate math to `aggregateExerciseStats`.
  ```ts
  export interface ExerciseSession {
    workoutId: string; workoutName: string | null; performedAt: Date
    sets: { setNumber: number; reps: number | null; weight: number | null; completed: boolean; metricMode: string; durationSec: number | null; distanceM: number | null }[]
  }
  export async function getExerciseSessions(
    userId: string, source: ExerciseSource, wgerExerciseId: number,
    opts: { limit: number; offset: number },
  ): Promise<ExerciseSession[]>
  ```
  Two-step like `getLastPerformance` (workouts.ts:76-99): first page workout ids — `select distinct workouts.id/startedAt/name` filtered as above, `orderBy(desc(workouts.startedAt)).limit(opts.limit).offset(opts.offset)` — then fetch those workouts' set rows for this exercise ordered by `setNumber`, group in JS. History shows ALL sets (including uncompleted and duration-mode) — display truth; only SCORING is completed-only.
- **MIRROR**: PARALLEL_READS + QUERY_SHAPE; two-step pattern of `getLastPerformance`.
- **GOTCHA**: (1) `eq(workoutExercises.source, source)` is mandatory — `getLastPerformance`/`getExerciseHistoryBefore` omit it (pre-existing gap; do not copy). (2) `isNotNull(workouts.completedAt)` is the completed-only invariant for BOTH functions. (3) Clamp `limit` at the function boundary (e.g. max 50) — callers are server components but the module guards itself, matching "reads still guard stored data" style.
- **VALIDATE**: Scoping tests via PgDialect where-introspection (Task 5).

### Task 5: Tests — `src/db/exercise-stats.test.ts`
- **ACTION**: Copy the program-stats.test.ts harness; test the pure function directly plus query scoping.
- **IMPLEMENT**: `aggregateExerciseStats` cases (AAA, descriptive names — "returns null records when no set is e1rm-scorable"):
  - weight_reps happy path: records + trend + strictly-greater tie keeps earliest session
  - bodyweight_reps with bodyweightKg null → no e1rm records, `mostReps` still derived
  - weighted_bodyweight / assisted_bodyweight effective-load math (assistance ≥ BW → null load skipped)
  - null-weight machine rows: excluded from tonnage and load records, included in `totalCompletedSets`
  - duration-mode rows: counted in sets, produce no records/trend
  - uncompleted rows never score; single-session history → records still fill from that one session
  - `bestSessionVolumeKg` sums only reps_weight both-non-null rows per session
  For queries: queue builder rows, assert where-params include userId, exercise id, source, and (via SQL text) `completed_at is not null`; `getExerciseSessions` asserts limit/offset propagation and set grouping/order.
- **MIRROR**: TEST_STRUCTURE.
- **GOTCHA**: Mock `./preferences` (`getBodyweightKg`) so the select queue counts only this module's reads (program-stats.test.ts:48-51 precedent).
- **VALIDATE**: `npm test` — new suite green, all existing suites untouched and green.

### Task 6: Update PRD phase table
- **ACTION**: In `.claude/PRPs/prds/exercise-stats.prd.md`, set Phase 1 status `pending` → `in-progress` and PRP Plan → this file's path.
- **VALIDATE**: Table renders; other phases untouched.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| weight_reps records | 2 sessions, rising e1RM | bestE1rm from session 2; trend length 2 | |
| e1rm tie | equal best e1RM in 2 sessions | earliest session wins all records | ✓ |
| no bodyweight stored | bodyweight_reps rows, bw=null | e1rm records null, mostReps set, trend [] | ✓ |
| assisted ≥ BW | assistance weight ≥ bodyweight | rows skipped from load scoring | ✓ |
| null-weight machine | reps set, weight null, weight_reps | in set counts; no tonnage/load records | ✓ |
| duration rows | metricMode 'duration' | counted sets; zero records/trend | ✓ |
| uncompleted rows | completed=false heavy set | never scores anything | ✓ |
| empty history | [] | `getExerciseStats` → null | ✓ |
| scoping | any | where includes userId+id+source+completedAt | ✓ |
| pagination | limit 2, offset 2 | correct page, sets grouped, setNumber asc | |

### Edge Cases Checklist
- [x] Empty input (no completed history → null)
- [x] Invalid types (non-integer/negative reps guarded, mirrors one-rep-max.ts:114)
- [x] Composite identity (custom id must never match wger id)
- [ ] Concurrent access — N/A, read-only module
- [ ] Network failure — N/A, no external calls

---

## Validation Commands

### Static Analysis
```bash
npm run lint
```
EXPECT: Zero errors

### Unit Tests
```bash
npm test
```
EXPECT: New exercise-stats suite passes; zero regressions (program-stats, last-performance, exercise-history suites unchanged)

### Full Build (type check happens here — no standalone tsc script)
```bash
npm run build
```
EXPECT: Clean build

### Database Validation
```bash
npm run db:generate && git diff --stat drizzle/
```
EXPECT: One new migration with a single CREATE INDEX on workout_exercises; snapshot updated. (Do NOT run db:migrate — deploys/migrations are applied manually per project convention.)

### Manual Validation
- [ ] None required this phase (no UI); Phase 2/3 exercise the module end-to-end

---

## Acceptance Criteria
- [ ] `aggregateExerciseStats` pure, exported, covered across all four logging types + duration rows
- [ ] `getExerciseStats` / `getExerciseSessions` filter userId + composite identity + completedAt IS NOT NULL
- [ ] Index migration generated, not hand-edited
- [ ] All validation commands pass
- [ ] PRD phase table updated

## Completion Checklist
- [ ] No raw `weight` reads outside the tonnage rule
- [ ] Strictly-greater tie policy everywhere
- [ ] Fresh structures, no input mutation
- [ ] Doc comments carry the authz-boundary + canonical-kg paragraphs
- [ ] No scope creep (no UI, no MCP, no duration records)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Full-history scan grows with data | M | L | Per-exercise scan is naturally bounded; index added; revisit with a capped/aggregated query only if it ever shows |
| Records disagree with program-stats PRs | L | M | Same scorer (`bestScoredSet`) + same tie policy; matrix tests pin semantics |
| Migration drift vs. prod | L | M | Generated-only SQL; manual deploy step applies it (standing convention) |

## Notes
- **Scorer extraction is a no-op**: the PRD's Phase-1 "extract scorer" task was already done in a prior feature — `src/lib/one-rep-max.ts` is the shared scorer and `program-stats.ts` already imports it. This plan drops that task; no characterization tests needed.
- **Module named `exercise-stats`, not `exercise-history`** (PRD said `exercise-history.ts`): `src/db/exercise-history.test.ts` already exists testing `getExerciseHistoryBefore` (a `workouts.ts` function). Distinct name avoids test-file collision and confusion.
- **Pre-existing gap observed, not fixed here**: `getLastPerformance` and `getExerciseHistoryBefore` filter by `wgerExerciseId` only — a custom exercise whose identity id collides with a wger id can pollute ghost values/prior-best. Worth a small follow-up fix outside this feature.
- Current-bodyweight-scores-all-history drift is accepted, same trade-off program-stats documents (program-stats.ts:133-135).
