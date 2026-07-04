# Plan: Programs & Routines — Phase 3 (Instantiation)

## Summary
Close the author→log loop: `instantiate_program_day` turns a program day into a dated, loggable `workout` — seeding each set with its suggested load (reps/durations blank), stamped with provenance (`workouts.program_day_id`, `program_week`). `get_workout` (and the `workout://{id}` resource) gain a **plan overlay** so the agent sees the prescription (rep range, RIR, set type, suggested load) next to the live sets. Plans stay on the program; reality stays on the workout — resolved by provenance, not duplication.

## User Story
As an intermediate→advanced lifter (or my agent), I want to "start today's Push" and get a dated workout pre-seeded with my suggested loads and the targets to beat, so that I can log the session with the existing tools while my real history stays clean.

## Problem → Solution
Phase 2 lets the agent author a program but there's no way to *run* one — the program tree and the workout tree are disconnected. → `instantiate_program_day` does a near 1:1 row copy (program day → dated workout), stamping provenance and seeding suggested loads; `get_workout` overlays the program prescription so targets are visible without ever writing them into a `sets` row.

## Metadata
- **Complexity**: Large
- **Source PRD**: `.claude/PRPs/prds/programs-and-routines.prd.md`
- **PRD Phase**: Phase 3 — Instantiation
- **Estimated Files**: 1 new test + 8 edited (`db/programs.ts`, `program-tools.ts`, `read-tools.ts`, `resources.ts` + their 4 tests, `tools.test.ts`)

---

## UX Design

Agent-facing. The "start today's day" flow now exists end-to-end.

### Before
```
upsert_program → get_program (read the plan)
   …but no way to turn a program day into a session you can log.
```
### After
```
instantiate_program_day(programDayId, week?) → { workoutId }
   → a dated workout: each set seeded with its suggested load, reps blank
get_workout(workoutId) → live sets PLUS a `plan` overlay:
   { setType, repMin..repMax, rir, rpe, suggestedLoad, tempo, technique }
   + provenance { programDayId, programWeek }
   → log with the existing update_set / add_set
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Start a session | `create_workout` (blank log) | `instantiate_program_day` (pre-seeded from the plan) | New tool; returns a `workoutId` the existing log tools accept |
| `get_workout` payload | actuals only | + `programDayId`/`programWeek` always; + `plan` overlay when instantiated | Targets read via join overlay, never written into a `sets` row |
| `get_last_performance` | unchanged | unchanged | Already ignores program templates by construction (they live in `program_*`, never queried) |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 (critical) | `src/db/workouts.ts` | 119-199 | `getWorkoutDetail` (nested read incl. the new `programDayId`/`programWeek` columns) + `saveWorkout`/`insertWorkoutChildren` — the exact transactional seed shape to mirror |
| P0 (critical) | `src/db/programs.ts` | all | Where `getProgramDayDetail` + `instantiateProgramDay` are added; the `getProgramDetail` nested-read pattern + ownership-via-join model |
| P0 (critical) | `src/lib/mcp/program-tools.ts` | all | `registerProgramTools` (add `instantiate_program_day`), `buildProgramPayload` (extract `buildProgramSetView`/`buildProgramDayView` for the overlay), conversion helpers |
| P0 (critical) | `src/lib/mcp/read-tools.ts` | 52-76, 160-224 | `get_workout` handler + `buildWorkoutPayload` (`WorkoutPayload`) — gains the optional plan overlay + provenance fields |
| P1 (important) | `src/db/schema.ts` | 14-26, 37-55, 84-176 | `workouts.programDayId`/`programWeek`, `sets.metricMode`/`durationSec`/`distanceM`, and the `programDays`/`programExercises`/`programSets` relations the overlay query traverses |
| P1 (important) | `src/lib/mcp/resources.ts` | all | The `workout://{id}` resource gets the same overlay (passes the program day to `buildWorkoutPayload`) |
| P1 (important) | `src/db/save-program.test.ts` | all | The recording-stub transaction test pattern to mirror for `instantiateProgramDay` |
| P1 (important) | `src/lib/mcp/program-tools.test.ts` | all | The fake-server tool-test pattern to extend for `instantiate_program_day` |
| P2 (reference) | `src/lib/mcp/read-tools.test.ts` | 156-256 | The `get_workout` `detail()` factory + assertion style to extend for the overlay |
| P2 (reference) | `src/lib/mcp/tools.test.ts` | 42-74 | The exact 20-tool list — becomes 21 (`instantiate_program_day`) |

## External Documentation
No external research needed — established internal patterns (transactional seed = `saveWorkout`; overlay projection = `buildProgramPayload`).

---

## Patterns to Mirror

### TRANSACTIONAL SEED (program day → workout)
```ts
// SOURCE: src/db/workouts.ts:143-199 (insertWorkoutChildren / saveWorkout)
return db.transaction(async (tx) => {
  const [workout] = await tx.insert(workouts)
    .values({ userId, name, programDayId, programWeek })
    .returning({ id: workouts.id })
  for (const [position, ex] of day.exercises.entries()) {
    const [we] = await tx.insert(workoutExercises)
      .values({ workoutId: workout.id, wgerExerciseId: ex.wgerExerciseId, name: ex.name, position })
      .returning({ id: workoutExercises.id })
    if (ex.sets.length > 0) {
      await tx.insert(sets).values(ex.sets.map((s, i) => ({
        workoutExerciseId: we.id, setNumber: i + 1,
        reps: null,                                                   // achievement: blank
        weight: s.metricMode === 'reps_weight' ? s.suggestedLoadKg : null, // prescribed load (kg)
        metricMode: s.metricMode,
        durationSec: null, distanceM: null,                          // achievement: blank
        completed: false,
      })))
    }
  }
  return { id: workout.id }
})
```

### OWNERSHIP-VIA-JOIN READ (one program day, owned)
```ts
// SOURCE: src/db/programs.ts:28-44 (getProgramDetail nested read) + schema relations
const day = await db.query.programDays.findFirst({
  where: eq(programDays.id, programDayId),
  with: {
    program: { columns: { userId: true } },                          // ownership gate
    exercises: { orderBy: (e) => [asc(e.position)], with: { sets: { orderBy: (s) => [asc(s.setNumber)] } } },
  },
})
if (!day || day.program.userId !== userId) return null               // not owned ⇒ null
return day
```

### OVERLAY PROJECTION (kg→display), reuse of buildProgramPayload's per-set logic
```ts
// SOURCE: src/lib/mcp/program-tools.ts:buildProgramPayload sets.map(...)
// Extract a shared buildProgramSetView(set, unit) used by BOTH buildProgramPayload
// and the new buildProgramDayView(day, unit) (the overlay). suggestedLoadKg→display,
// technique/progression verbatim, distanceM never converted.
```

### TOOL HANDLER (resolve user → guard id → op → not-found → echo)
```ts
// SOURCE: src/lib/mcp/program-tools.ts (delete_program / set_program_status)
const resolved = resolveUserId(extra, userId)
assertProgramIdShape(programDayId)                                   // before any DB call
const result = await instantiateProgramDay(resolved, programDayId, week ?? 1)
if (!result) throw new ToolError(`Program day ${programDayId} not found for user ${resolved}`)
return jsonResult({ userId: resolved, workoutId: result.id, programDayId, programWeek: week ?? 1 })
```

### GET_WORKOUT OVERLAY WIRING
```ts
// SOURCE: src/lib/mcp/read-tools.ts:60-75 (get_workout), extended
const workout = await getWorkoutDetail(resolved, id)
if (!workout) return errorResult(new ToolError(`Workout ${id} not found for user ${resolved}`))
const unit = await getWeightUnit(resolved)
const programDay = workout.programDayId
  ? await getProgramDayDetail(resolved, workout.programDayId)
  : null
return jsonResult(buildWorkoutPayload(workout, resolved, unit, programDay ?? undefined))
```

### TEST STRUCTURE — recording-stub transaction (seed)
```ts
// SOURCE: src/db/save-program.test.ts (records[] + ID_SEQUENCE + vi.mock('./index'))
// For instantiateProgramDay: stub db.query.programDays.findFirst to return a day, then
// assert the workout/exercise/set inserts (provenance on the workout row, seeded weights,
// blank reps).
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/programs.ts` | UPDATE | + `getProgramDayDetail` (+ `ProgramDayDetail` type) and `instantiateProgramDay`; import `workouts`/`workoutExercises`/`sets` |
| `src/db/instantiate-program.test.ts` | CREATE | Transactional seed test (provenance + seeded loads + blank achievements) |
| `src/lib/mcp/program-tools.ts` | UPDATE | + `instantiate_program_day` tool; extract `buildProgramSetView`, add+export `buildProgramDayView` (overlay projection) |
| `src/lib/mcp/program-tools.test.ts` | UPDATE | + `instantiate_program_day` tests; tool count 5→6 |
| `src/lib/mcp/read-tools.ts` | UPDATE | `get_workout` overlay; `buildWorkoutPayload` gains optional `programDay` + payload gains `programDayId`/`programWeek`/`plan` |
| `src/lib/mcp/read-tools.test.ts` | UPDATE | Overlay tests; add provenance fields to the `detail()` factory |
| `src/lib/mcp/resources.ts` | UPDATE | `workout://{id}` passes the program day to `buildWorkoutPayload` (parity with the tool) |
| `src/lib/mcp/resources.test.ts` | UPDATE | Overlay assertion; provenance fields in the workout factory |
| `src/lib/mcp/tools.test.ts` | UPDATE | Expected tool list 20→21 (`instantiate_program_day`) |

## NOT Building (this phase)
- **Week-N progression** — `program_week` is *stamped* but the seeded loads are always the week-1 template (`suggestedLoadKg`). Computing progressed week-N targets is Phase 5.
- **Week upper-bound validation** (`week ≤ mesocycleWeeks`) — `week` is a positive-int provenance stamp with no functional effect yet; bound-checking belongs with Phase 5 week semantics.
- **Auto-advancing the week counter** on finish — explicit `week` arg only (PRD open question; deferred).
- **Writing targets into `sets` rows** — targets are read via the overlay join, never duplicated (PRD architecture rule).
- **Granular program patch tools** — Phase 4. **Progression/technique execution** — Phase 5. **Web UI** — Phase 6.

---

## Design Detail

### `db/programs.ts` additions
```ts
import { workouts, workoutExercises, sets } from './schema' // add to existing import

export async function getProgramDayDetail(userId: string, programDayId: string) {
  const day = await db.query.programDays.findFirst({
    where: eq(programDays.id, programDayId),
    with: {
      program: { columns: { userId: true } },
      exercises: {
        orderBy: (e) => [asc(e.position)],
        with: { sets: { orderBy: (s) => [asc(s.setNumber)] } },
      },
    },
  })
  if (!day || day.program.userId !== userId) return null
  return day
}
export type ProgramDayDetail = NonNullable<Awaited<ReturnType<typeof getProgramDayDetail>>>

export async function instantiateProgramDay(
  userId: string,
  programDayId: string,
  week: number,
): Promise<{ id: string } | null> {
  const day = await getProgramDayDetail(userId, programDayId)
  if (!day) return null
  return db.transaction(async (tx) => {
    const [workout] = await tx
      .insert(workouts)
      .values({ userId, name: day.name, programDayId, programWeek: week })
      .returning({ id: workouts.id })
    for (const [position, exercise] of day.exercises.entries()) {
      const [we] = await tx
        .insert(workoutExercises)
        .values({ workoutId: workout.id, wgerExerciseId: exercise.wgerExerciseId, name: exercise.name, position })
        .returning({ id: workoutExercises.id })
      if (exercise.sets.length > 0) {
        await tx.insert(sets).values(
          exercise.sets.map((s, i) => ({
            workoutExerciseId: we.id,
            setNumber: i + 1,
            reps: null,
            weight: s.metricMode === 'reps_weight' ? s.suggestedLoadKg : null,
            metricMode: s.metricMode,
            durationSec: null,
            distanceM: null,
            completed: false,
          })),
        )
      }
    }
    return { id: workout.id }
  })
}
```

### `program-tools.ts` — overlay projection + tool
```ts
// Extract from the existing buildProgramPayload sets.map(...):
function buildProgramSetView(s: ProgramDetail['days'][number]['exercises'][number]['sets'][number], unit: WeightUnit) {
  return {
    setNumber: s.setNumber, setType: s.setType, metricMode: s.metricMode,
    repMin: s.repMin, repMax: s.repMax, rir: s.rir, rpe: s.rpe,
    suggestedLoad: s.suggestedLoadKg === null ? null : kgToDisplay(s.suggestedLoadKg, unit),
    tempo: s.tempo, durationSec: s.durationSec, distanceM: s.distanceM, technique: s.technique,
  }
}
// New, exported for the overlay (read-tools + resources):
export interface ProgramDayView {
  programDayId: string
  name: string
  exercises: { position: number; wgerExerciseId: number; name: string; progression: unknown | null; sets: ReturnType<typeof buildProgramSetView>[] }[]
}
export function buildProgramDayView(day: ProgramDayDetail, unit: WeightUnit): ProgramDayView {
  return {
    programDayId: day.id, name: day.name,
    exercises: day.exercises.map((e) => ({
      position: e.position, wgerExerciseId: e.wgerExerciseId, name: e.name, progression: e.progression,
      sets: e.sets.map((s) => buildProgramSetView(s, unit)),
    })),
  }
}
// buildProgramPayload's sets.map(...) is refactored to call buildProgramSetView (DRY, same output).

// Tool (registered in registerProgramTools — 6th tool):
server.registerTool('instantiate_program_day', {
  title: 'Instantiate Program Day',
  description:
    "Starts a dated workout from a program day: seeds each set with its suggested load (reps/durations left blank for you to log) and stamps the program/week. Pass `week` (default 1). Returns the new workoutId — log it with update_set/add_set. Errors if the program day isn't found or owned.",
  inputSchema: { programDayId: z.string(), week: z.number().int().positive().optional(), userId: z.string().optional() },
}, async ({ programDayId, week, userId }, extra) => {
  try {
    const resolved = resolveUserId(extra, userId)
    assertProgramIdShape(programDayId)
    const result = await instantiateProgramDay(resolved, programDayId, week ?? 1)
    if (!result) throw new ToolError(`Program day ${programDayId} not found for user ${resolved}`)
    return jsonResult({ userId: resolved, workoutId: result.id, programDayId, programWeek: week ?? 1 })
  } catch (error: unknown) { return errorResult(error) }
})
```

### `read-tools.ts` — `buildWorkoutPayload` gains the overlay
```ts
// WorkoutPayload.workout gains: programDayId: string | null; programWeek: number | null; plan?: ProgramDayView | null
export function buildWorkoutPayload(
  workout: WorkoutDetail, resolved: string, unit: WeightUnit, programDay?: ProgramDayDetail,
): WorkoutPayload {
  return {
    userId: resolved, unit,
    workout: {
      id: workout.id, name: workout.name, startedAt: workout.startedAt.toISOString(),
      programDayId: workout.programDayId, programWeek: workout.programWeek,
      ...(programDay ? { plan: buildProgramDayView(programDay, unit) } : {}),
      exercises: workout.exercises.map(/* unchanged */),
    },
  }
}
```
Imports added to read-tools: `getProgramDayDetail, type ProgramDayDetail` from `@/db/programs`; `buildProgramDayView, type ProgramDayView` from `./program-tools`.

---

## Step-by-Step Tasks

### Task 1: `db/programs.ts` — `getProgramDayDetail` + `instantiateProgramDay`
- **ACTION**: Add both functions + the `ProgramDayDetail` type; import the workout tables.
- **IMPLEMENT**: Per Design Detail. `getProgramDayDetail` gates on `day.program.userId === userId` (ownership) and returns the day with ordered exercises→sets. `instantiateProgramDay` loads it, then one `db.transaction` seeding the workout (provenance) + exercises + sets (weight = `suggestedLoadKg` only when `metric_mode === 'reps_weight'`; reps/durations/distance blank; `completed:false`).
- **MIRROR**: OWNERSHIP-VIA-JOIN READ + TRANSACTIONAL SEED.
- **IMPORTS**: add `workouts, workoutExercises, sets` to the existing `./schema` import.
- **GOTCHA**: Read the day OUTSIDE then seed INSIDE the transaction (mirrors how the read precedes the write). `program.userId !== userId` ⇒ return `null` (the tool maps to not-found). Seed `setNumber = i + 1` (1-based), `position` 0-based — same as `insertWorkoutChildren`.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 2: `db/instantiate-program.test.ts`
- **ACTION**: Recording-stub transaction test mirroring `save-program.test.ts`.
- **IMPLEMENT**: `vi.mock('./index')` with a `db` exposing BOTH `query.programDays.findFirst` (returns a fixture day: `program.userId = USER`, one exercise, two sets — a `reps_weight` set w/ `suggestedLoadKg` and a `duration` set) AND the recording `transaction` stub (records insert `.values`). Assert: workout insert `{ userId, name, programDayId, programWeek }`; exercise insert `{ position:0 }`; sets insert `[{ setNumber:1, reps:null, weight:<kg>, metricMode:'reps_weight', completed:false }, { setNumber:2, weight:null, metricMode:'duration', durationSec:null }]`. Add an ownership test: `findFirst` returns a day whose `program.userId ≠ USER` ⇒ resolves `null`, transaction never runs.
- **MIRROR**: TEST STRUCTURE — recording-stub.
- **IMPORTS**: `vi`, the `vi.mock('./index', ...)` shape from `save-program.test.ts`.
- **GOTCHA**: The stub `db` needs `query.programDays.findFirst` returning the fixture (not the Drizzle builder), plus `transaction`. Insert order in records: workout(0), exercise(1), sets(2).
- **VALIDATE**: `npx vitest run src/db/instantiate-program.test.ts`.

### Task 3: `program-tools.ts` — overlay projection + `instantiate_program_day`
- **ACTION**: Extract `buildProgramSetView`; add+export `buildProgramDayView` + `ProgramDayView`; register `instantiate_program_day`.
- **IMPLEMENT**: Refactor `buildProgramPayload`'s `sets.map` to call `buildProgramSetView` (identical output). Add the tool per Design Detail.
- **MIRROR**: OVERLAY PROJECTION + TOOL HANDLER.
- **IMPORTS**: add `instantiateProgramDay, type ProgramDayDetail` from `@/db/programs`.
- **GOTCHA**: `assertProgramIdShape(programDayId)` BEFORE the DB call (the Phase-2 review lesson). Register the new tool inside `registerProgramTools` (now 6 tools).
- **VALIDATE**: `npx tsc --noEmit`.

### Task 4: `program-tools.test.ts` — instantiate tests + count
- **ACTION**: Update the "registers exactly the … program tools" list to 6 (add `instantiate_program_day`); add a describe block.
- **IMPLEMENT**: mock `instantiateProgramDay`; assert: success → `{ userId, workoutId, programDayId, programWeek }` with `week` defaulting to 1; explicit `week:2` echoed; not-found (op→null) → `/not found/`; malformed id → `/not found/`, op untouched; no-user gate → `/userId/`.
- **MIRROR**: existing program-tools test cases.
- **VALIDATE**: `npx vitest run src/lib/mcp/program-tools.test.ts`.

### Task 5: `read-tools.ts` — `get_workout` overlay
- **ACTION**: Fetch the program day when `workout.programDayId` is set; pass to `buildWorkoutPayload`. Extend `WorkoutPayload` + `buildWorkoutPayload`.
- **IMPLEMENT**: Per Design Detail. `WorkoutPayload.workout` gains `programDayId`/`programWeek` (always) and optional `plan`.
- **MIRROR**: GET_WORKOUT OVERLAY WIRING.
- **IMPORTS**: `getProgramDayDetail, type ProgramDayDetail` from `@/db/programs`; `buildProgramDayView, type ProgramDayView` from `./program-tools`.
- **GOTCHA**: Only fetch the day when `programDayId` is non-null (no wasted query for ad-hoc workouts). No import cycle: `read-tools → program-tools` is one-directional (program-tools does not import read-tools).
- **VALIDATE**: `npx tsc --noEmit`.

### Task 6: `read-tools.test.ts` — overlay + factory fields
- **ACTION**: Add `programDayId:null, programWeek:null` to the `detail()` factory; add overlay tests + a `@/db/programs` mock.
- **IMPLEMENT**: Add `vi.mock('@/db/programs', () => ({ getProgramDayDetail: vi.fn() }))`. New tests: (a) `getWorkoutDetail` returns a workout with `programDayId` set + `getProgramDayDetail` returns a day ⇒ payload has `programDayId`, `programWeek`, and a `plan` with `suggestedLoad` in lb; (b) `programDayId` null ⇒ `getProgramDayDetail` NOT called, no `plan`.
- **MIRROR**: read-tools.test get_workout block.
- **GOTCHA**: The new `@/db/programs` mock must not disturb existing read-tool tests; default `getProgramDayDetail` unset/not-called.
- **VALIDATE**: `npx vitest run src/lib/mcp/read-tools.test.ts`.

### Task 7: `resources.ts` — workout resource overlay
- **ACTION**: In the `workout` resource read callback, fetch the program day when `workout.programDayId` and pass to `buildWorkoutPayload`.
- **IMPLEMENT**: Mirror Task 5's fetch inside the resource callback.
- **MIRROR**: GET_WORKOUT OVERLAY WIRING.
- **IMPORTS**: add `getProgramDayDetail` (the file already imports `getProgramDetail` from `@/db/programs`).
- **GOTCHA**: Keep the leak-safe try/catch unchanged.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 8: `resources.test.ts` — overlay + factory
- **ACTION**: Add `getProgramDayDetail` to the `@/db/programs` mock; add `programDayId`/`programWeek` to the workout `detail()` factory; add an overlay assertion for the workout resource.
- **IMPLEMENT**: One test: workout with `programDayId` set + `getProgramDayDetail` returning a day ⇒ resource JSON includes `plan`.
- **MIRROR**: resources.test workout block.
- **VALIDATE**: `npx vitest run src/lib/mcp/resources.test.ts`.

### Task 9: `tools.test.ts` — tool list 20→21
- **ACTION**: Add `'instantiate_program_day'` to the sorted expected list (between `get_workout` and `list_programs`).
- **VALIDATE**: `npx vitest run src/lib/mcp/tools.test.ts`.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected | Edge? |
|---|---|---|---|
| instantiate seeds provenance + loads | day w/ reps_weight + duration sets | workout `{programDayId, programWeek}`, set1 `{weight:kg,reps:null,metricMode:reps_weight}`, set2 `{weight:null,metricMode:duration,durationSec:null}` | no |
| instantiate not owned | day.program.userId ≠ user | returns null, no transaction | yes |
| tool success | `{programDayId, week:2}` | `{workoutId, programDayId, programWeek:2}` | no |
| tool default week | no `week` | `programWeek:1` | yes |
| tool not-found | op → null | `/not found/` | yes |
| tool malformed id | `'not-a-uuid'` | `/not found/`, op untouched | yes |
| tool no-user | no env/arg | `/userId/`, op untouched | yes |
| get_workout overlay | workout w/ programDayId | payload has `plan` (suggestedLoad in lb) + provenance | no |
| get_workout no overlay | programDayId null | no `plan`, `getProgramDayDetail` not called | yes |
| resource overlay | workout w/ programDayId | resource JSON has `plan` | no |
| tool list | — | 21 tools incl. `instantiate_program_day` | no |

### Edge Cases Checklist
- [x] Empty input (program day with zero exercises → workout with no children; tolerated)
- [x] Invalid types (week non-positive rejected by zod; malformed id guarded)
- [ ] Concurrent access (read-then-seed TOCTOU acceptable for single-user POC; deferrable unique unchanged)
- [x] Network failure (db-leak path inherited from the shared handler shape)
- [x] Permission denied (not-owned program day → not-found; no-user gate)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors.

### Unit Tests (affected area)
```bash
npx vitest run src/lib/mcp src/db
```
EXPECT: All MCP + db tests pass.

### Full Test Suite (no regressions)
```bash
npx vitest run --exclude '**/.claude/worktrees/**'
```
EXPECT: All pass (stray worktree excluded — known pollution).

### Lint
```bash
npx eslint src
```
EXPECT: Clean.

### Build
```bash
npm run build
```
EXPECT: Succeeds; route table unchanged.

### Manual Validation (dogfood)
- [ ] `upsert_program` a 2-day split → `instantiate_program_day` day 0 → `get_workout` shows seeded loads + `plan` targets → `update_set` logs reps → history clean (`list_workouts` shows the session, `get_program` unchanged).

---

## Acceptance Criteria
- [ ] All 9 tasks complete; `tsc`, `eslint src`, `vitest --exclude worktrees`, `npm run build` pass.
- [ ] `instantiate_program_day` yields a dated workout seeded with suggested loads (reps blank), stamped with `programDayId`/`programWeek`.
- [ ] `get_workout` on an instantiated workout shows the `plan` overlay (targets) + provenance; logging via `update_set` works.
- [ ] Plan targets are never written into a `sets` row (only `suggestedLoadKg`→`weight` seed); `get_last_performance` unchanged.
- [ ] Ownership + no-user gate enforced; not-owned program day → clean not-found.

## Completion Checklist
- [ ] Seed mirrors `saveWorkout`/`insertWorkoutChildren` (0-based position, 1-based setNumber, one transaction).
- [ ] Overlay reuses `buildProgramSetView` (no projection drift between `get_program` and the overlay).
- [ ] `get_workout` + `workout://{id}` both carry provenance; both overlay when instantiated.
- [ ] `read-tools → program-tools` import is one-directional (no cycle).
- [ ] Tests mirror recording-stub + fake-server patterns.
- [ ] Self-contained — no codebase searching needed.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Import cycle read-tools ↔ program-tools | M | Med | One-directional only (read-tools imports program-tools; program-tools never imports read-tools); tsc catches a cycle's type fallout |
| `tools.test.ts` exact-list assertion breaks | M (expected) | Low | Task 9 updates it deliberately |
| `getProgramDayDetail` ownership via `day.program.userId` mis-wired | L | High | The `program: one(programs)` relation exists (Phase 1); test the not-owned path returns null |
| Seeded duration sets confuse (weight null) | L | Low | `weight` seeded only for `reps_weight`; documented in the tool description and tested |
| Read-then-seed TOCTOU | L | Low | Single-user POC; acceptable, noted |

## Notes
- This phase + Phases 1–2 complete the PRD's MVP (the hypothesis: author → start pre-seeded session → log → clean history).
- `program_week` is provenance only here; Phase 5's progression engine reads it to compute week-N targets. Instantiating "week 3" today seeds week-1 loads but stamps week 3 — forward-compatible.
- `get_last_performance` needs **no** change: program templates live in `program_*` tables, which it never queries — the clean-history criterion holds by the Phase-1 schema separation. (A freshly-instantiated, not-yet-logged workout is a real `workouts` row with seeded weights and null reps; it legitimately represents the in-progress session, not a template.)
- The overlay is a **workout-level `plan`** (the whole day prescription) the agent correlates by `position`/`setNumber`, rather than interleaving per-set — keeps `buildWorkoutPayload`'s exercise loop untouched and the projection shared with `get_program`.
