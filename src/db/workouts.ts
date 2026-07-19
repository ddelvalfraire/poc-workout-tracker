import { and, asc, count, countDistinct, desc, eq, gt, inArray, lt, max, ne, sql } from 'drizzle-orm'
import type { WorkoutInput, LoggingType } from '@/lib/workout-input'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { db } from './index'
import { workouts, workoutExercises, sets } from './schema'

/**
 * Data access for workouts, always scoped to a Clerk userId.
 *
 * The app has no Postgres row-level security (Clerk issues the identity, not
 * Supabase), so this module is the authorization boundary: every query filters
 * by user_id. Route handlers must go through these helpers rather than querying
 * `workouts` directly, so a caller can never read or mutate another user's data.
 */

/** Lists a user's workouts, most recent first. */
export function listWorkouts(userId: string) {
  return db
    .select()
    .from(workouts)
    .where(eq(workouts.userId, userId))
    .orderBy(desc(workouts.startedAt))
}

/** A history-list row: a workout plus aggregate counts of its exercises/sets. */
export interface WorkoutSummary {
  id: string
  name: string | null
  startedAt: Date
  completedAt: Date | null
  exerciseCount: number
  setCount: number
  completedSetCount: number
  volumeKg: number
}

/** Lists a user's workouts (most recent first) with exercise/set counts and
 *  total volume (Σ reps × weight kg; duration/distance sets contribute 0), in
 *  one query. */
export function listWorkoutSummaries(userId: string) {
  return db
    .select({
      id: workouts.id,
      name: workouts.name,
      startedAt: workouts.startedAt,
      completedAt: workouts.completedAt,
      exerciseCount: countDistinct(workoutExercises.id),
      setCount: count(sets.id),
      // For the in-progress session banner: how far into the session the
      // last device got, from the saved rows.
      completedSetCount: sql<number>`coalesce(sum(case when ${sets.completed} then 1 else 0 end), 0)`.mapWith(Number),
      volumeKg: sql<number>`coalesce(sum(${sets.reps} * ${sets.weight}), 0)`.mapWith(Number),
    })
    .from(workouts)
    .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
    .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
    .where(eq(workouts.userId, userId))
    .groupBy(workouts.id)
    .orderBy(desc(workouts.startedAt))
}

/** A prior performance of an exercise: when it was done and its sets (weights in kg, set order). */
export interface LastPerformance {
  performedAt: Date
  sets: { reps: number | null; weight: number | null }[]
}

/**
 * Most recent prior performance of the exercise for the user, by workout
 * startedAt. Identity is the composite (source, id) — a custom exercise's id
 * can collide with a wger id and the two must never share ghosts.
 * `excludeWorkoutId` omits the workout currently being edited so it doesn't
 * report itself. Returns null when there's no history.
 */
export async function getLastPerformance(
  userId: string,
  source: ExerciseSource,
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
        eq(workoutExercises.source, source),
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

/** Flat set rows (reps/weight in kg) for the given exercises across the user's
 *  workouts STARTED BEFORE `before` — the corpus for prior-best/PR comparison.
 *  Excludes the current workout naturally via the time bound. */
export async function getExerciseHistoryBefore(
  userId: string,
  wgerExerciseIds: number[],
  before: Date,
): Promise<
  {
    wgerExerciseId: number
    source: ExerciseSource
    reps: number | null
    weight: number | null
    loggingType: LoggingType
  }[]
> {
  if (wgerExerciseIds.length === 0) return []
  return db
    .select({
      wgerExerciseId: workoutExercises.wgerExerciseId,
      // The query stays id-based (an IN over composite pairs buys nothing at
      // this corpus size); callers MUST match rows on (source, id).
      source: workoutExercises.source,
      reps: sets.reps,
      weight: sets.weight,
      // The row's OWN logging type: `weight` is only a total load for
      // weight_reps rows — scorers must not read BW-type rows raw.
      loggingType: workoutExercises.loggingType,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(
      and(
        eq(workouts.userId, userId),
        inArray(workoutExercises.wgerExerciseId, wgerExerciseIds),
        lt(workouts.startedAt, before),
      ),
    )
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

/** Creates a workout owned by the given user. */
export function createWorkout(userId: string, name?: string) {
  return db.insert(workouts).values({ userId, name }).returning()
}

/** The transaction handle, lifted from the callback signature (no internal import). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The set-level facts that must survive updateWorkout's full replace: the
 *  prescribed-at-instantiation snapshot (immutable — input can never carry
 *  it) and any backoff/amrap typing the logger UI can't express. Keyed by
 *  (source, exerciseId, setNumber) — see priorFactKey. */
interface PriorSetFacts {
  setType: 'working' | 'warmup' | 'backoff' | 'amrap'
  prescribedLoadKg: number | null
  prescribedRepMin: number | null
}

function priorFactKey(source: string, wgerExerciseId: number, setNumber: number): string {
  return `${source}:${wgerExerciseId}:${setNumber}`
}

/** Inserts a workout's exercises + sets (shared by saveWorkout and
 *  updateWorkout). `priorFacts` re-stamps replace-surviving facts onto the
 *  re-inserted rows (updateWorkout only): snapshots always; setType only for
 *  backoff/amrap, which the draft UI can't express — working↔warmup retags
 *  from the input win.
 *
 *  Facts match by POSITION, so they carry forward only while positions can
 *  still align (`priorSetCounts` gate): a SHRUNK set list proves a removal
 *  shifted later positions, and positionally re-stamped snapshots would
 *  attribute one set's prescription to another — evidence corruption. A
 *  shrunk exercise drops its facts instead (unscorable → the autoreg engine
 *  stays silent; silence over corruption). Appends keep positions 1..n
 *  aligned, so same-or-grown lists carry facts — the common add-a-set flow
 *  must not shed evidence. Residual: a remove+add that nets to same-or-more
 *  sets still matches positionally — accepted, bounded by the engine's
 *  load-floor screening and 3-stall rule. */
async function insertWorkoutChildren(
  tx: Tx,
  workoutId: string,
  exercises: WorkoutInput['exercises'],
  priorFacts?: Map<string, PriorSetFacts>,
  priorSetCounts?: Map<string, number>,
) {
  for (const [position, exercise] of exercises.entries()) {
    const [we] = await tx
      .insert(workoutExercises)
      .values({
        workoutId,
        wgerExerciseId: exercise.wgerExerciseId,
        name: exercise.name,
        position,
        // Omit when absent so the column default ('weight_reps') applies —
        // pre-logging-type callers (older MCP clients) keep their shape.
        ...(exercise.loggingType !== undefined ? { loggingType: exercise.loggingType } : {}),
        // Same rule for the identity discriminator (default 'wger').
        ...(exercise.source !== undefined ? { source: exercise.source } : {}),
        // Notes/skipped: absent → column defaults (null / false). A full
        // replace without them therefore clears both — the input IS the state.
        ...(exercise.notes !== undefined ? { notes: exercise.notes } : {}),
        ...(exercise.skipped !== undefined ? { skipped: exercise.skipped } : {}),
      })
      .returning({ id: workoutExercises.id })

    if (exercise.sets.length > 0) {
      const exerciseKey = `${exercise.source ?? 'wger'}:${exercise.wgerExerciseId}`
      const priorCount = priorSetCounts?.get(exerciseKey)
      const positionsAlign = priorCount !== undefined && exercise.sets.length >= priorCount
      await tx.insert(sets).values(
        exercise.sets.map((s, i) => {
          const fact = positionsAlign
            ? priorFacts?.get(
                priorFactKey(exercise.source ?? 'wger', exercise.wgerExerciseId, i + 1),
              )
            : undefined
          const keepPriorType =
            s.setType === undefined &&
            (fact?.setType === 'backoff' || fact?.setType === 'amrap')
          return {
            workoutExerciseId: we.id,
            setNumber: i + 1,
            reps: s.reps,
            weight: s.weight,
            completed: s.completed ?? false,
            // Omit when absent so the column default ('working') applies —
            // same additive rule as loggingType above.
            ...(s.setType !== undefined ? { setType: s.setType } : {}),
            ...(keepPriorType && fact ? { setType: fact.setType } : {}),
            ...(fact
              ? {
                  prescribedLoadKg: fact.prescribedLoadKg,
                  prescribedRepMin: fact.prescribedRepMin,
                }
              : {}),
          }
        }),
      )
    }
  }
}

/**
 * Persists a full workout — the `workouts` row plus its nested
 * `workout_exercises` and `sets` — for the given user, atomically.
 *
 * Everything runs inside one `db.transaction`, so a partial save can never
 * happen: either the whole tree commits or nothing does. The workout is stamped
 * with `userId`; the children inherit ownership through `workoutId`, so the
 * user-scoping invariant of this module holds for the entire tree without
 * filtering each child on `userId`.
 *
 * `position` is the 0-based order an exercise was added; `setNumber` is the
 * 1-based order of a set within its exercise. Runs on the Supabase transaction
 * pooler (single connection per checkout; `prepare:false` set in ./index).
 */
export async function saveWorkout(userId: string, input: WorkoutInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [workout] = await tx
      .insert(workouts)
      // Omit startedAt when absent so the column default (now()) applies.
      // Saving a manual log IS completing the session, so completedAt is
      // stamped here (instantiated program workouts get theirs on first edit).
      // A backdated save (explicit startedAt, e.g. MCP create_workout logging
      // last week's session) completes at that same moment — a wall-clock
      // completedAt would contradict the session's actual date and corrupt
      // anything keyed on completion time.
      .values({
        userId,
        name: input.name,
        notes: input.notes,
        completedAt: input.completedAt ?? input.startedAt ?? new Date(),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      })
      .returning({ id: workouts.id })

    await insertWorkoutChildren(tx, workout.id, input.exercises)

    return { id: workout.id }
  })
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
      // Omit startedAt when absent so the existing value is preserved.
      // First edit completes a not-yet-completed workout (instantiated program
      // days are logged through the edit flow); later edits keep the original.
      // As in saveWorkout, an explicit startedAt (backdated edit) is also the
      // completion moment — never stamp wall-clock time onto a past session.
      .set({
        name: input.name ?? null,
        // Same full-replace rule as name: an input without notes clears them.
        notes: input.notes ?? null,
        completedAt: (() => {
          const explicit = input.completedAt ?? input.startedAt
          // Serialize to ISO here: a param inside a raw sql`` fragment skips
          // the column's Date→string mapping, and postgres.js rejects a raw
          // Date instance (ERR_INVALID_ARG_TYPE).
          return explicit !== undefined
            ? sql`coalesce(${workouts.completedAt}, ${explicit.toISOString()})`
            : sql`coalesce(${workouts.completedAt}, now())`
        })(),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      })
      .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
      .returning({ id: workouts.id })
    if (!owned) return null

    // Capture the replace-surviving facts BEFORE the delete: the prescribed_*
    // snapshot is immutable provenance the wire input can never carry, and
    // backoff/amrap typing has no draft-UI representation — a full replace
    // must not silently erase either. First slot wins on a duplicated
    // exercise (position order), mirroring the logger's keying.
    const priorRows = await tx
      .select({
        wgerExerciseId: workoutExercises.wgerExerciseId,
        source: workoutExercises.source,
        setNumber: sets.setNumber,
        setType: sets.setType,
        prescribedLoadKg: sets.prescribedLoadKg,
        prescribedRepMin: sets.prescribedRepMin,
      })
      .from(sets)
      .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
      .where(eq(workoutExercises.workoutId, id))
      .orderBy(asc(workoutExercises.position), asc(sets.setNumber))
    const priorFacts = new Map<string, PriorSetFacts>()
    // Sets captured per exercise (first slot) — the structure-unchanged gate
    // in insertWorkoutChildren compares against the incoming set count.
    const priorSetCounts = new Map<string, number>()
    for (const row of priorRows) {
      const key = priorFactKey(row.source, row.wgerExerciseId, row.setNumber)
      if (!priorFacts.has(key)) {
        priorFacts.set(key, {
          setType: row.setType,
          prescribedLoadKg: row.prescribedLoadKg,
          prescribedRepMin: row.prescribedRepMin,
        })
        const exerciseKey = `${row.source}:${row.wgerExerciseId}`
        priorSetCounts.set(exerciseKey, (priorSetCounts.get(exerciseKey) ?? 0) + 1)
      }
    }

    await tx.delete(workoutExercises).where(eq(workoutExercises.workoutId, id))
    await insertWorkoutChildren(tx, id, input.exercises, priorFacts, priorSetCounts)
    return { id }
  })
}

/**
 * Resolves a workout-exercise id only when the workout is owned by the user. The
 * join to `workouts.userId` is the ownership gate for every set-level edit below:
 * a caller can address a set only through an exercise that belongs to a workout
 * they own. Returns null when the workout isn't owned or no exercise sits at that
 * 0-based position.
 */
async function findOwnedExerciseId(
  tx: Tx,
  userId: string,
  workoutId: string,
  position: number,
): Promise<string | null> {
  const [we] = await tx
    .select({ id: workoutExercises.id })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(
      and(
        eq(workoutExercises.workoutId, workoutId),
        eq(workoutExercises.position, position),
        eq(workouts.userId, userId),
      ),
    )
    .limit(1)
  return we?.id ?? null
}

/** A single-set edit. An omitted key is left unchanged; an explicit `null` clears it. */
export interface SetPatch {
  reps?: number | null
  weight?: number | null // kg
  /** In-session check-off state; boolean only (the column is NOT NULL). */
  completed?: boolean
}

/**
 * Marks an owned workout completed if it isn't already. Set-level edits are how
 * instantiated program workouts get logged (the MCP patch tools), so a
 * successful set write doubles as the completion signal — mirroring
 * `updateWorkout`, where the web logger's first edit stamps `completedAt`. The
 * coalesce keeps an existing completion time untouched. Ownership is already
 * proven by `findOwnedExerciseId` before any caller reaches this.
 */
async function stampWorkoutCompleted(tx: Tx, workoutId: string): Promise<void> {
  await tx
    .update(workouts)
    .set({ completedAt: sql`coalesce(${workouts.completedAt}, now())` })
    .where(eq(workouts.id, workoutId))
}

/**
 * Updates one set (reps and/or weight) of an owned workout's exercise, addressed
 * by 0-based exercise `position` and 1-based `setNumber`. Returns null when the
 * patch is empty, the workout isn't owned, the position is absent, or no such set
 * exists — the tool layer turns that into a not-found.
 */
export async function updateSet(
  userId: string,
  workoutId: string,
  exercisePosition: number,
  setNumber: number,
  patch: SetPatch,
): Promise<{ id: string } | null> {
  const values = {
    ...(patch.reps !== undefined ? { reps: patch.reps } : {}),
    ...(patch.weight !== undefined ? { weight: patch.weight } : {}),
    ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
  }
  if (Object.keys(values).length === 0) return null
  return db.transaction(async (tx) => {
    const exerciseId = await findOwnedExerciseId(tx, userId, workoutId, exercisePosition)
    if (!exerciseId) return null
    const [updated] = await tx
      .update(sets)
      .set(values)
      .where(and(eq(sets.workoutExerciseId, exerciseId), eq(sets.setNumber, setNumber)))
      .returning({ id: sets.id })
    if (!updated) return null
    await stampWorkoutCompleted(tx, workoutId)
    return updated
  })
}

/**
 * Appends a set to an owned exercise, numbered one past the current last set.
 * Returns the new 1-based `setNumber`, or null when the workout isn't owned or
 * the exercise position is absent.
 */
export async function addSet(
  userId: string,
  workoutId: string,
  exercisePosition: number,
  // Callers that know the set's role forward it; without one the DB default
  // 'working' stands (the MCP add_set path). Ad-hoc adds carry NO
  // prescribed_* snapshot — they were never prescribed, so the autoreg
  // engine treats them as unscorable.
  patch: SetPatch & { setType?: 'working' | 'warmup' | 'backoff' | 'amrap' },
): Promise<{ setNumber: number } | null> {
  return db.transaction(async (tx) => {
    const exerciseId = await findOwnedExerciseId(tx, userId, workoutId, exercisePosition)
    if (!exerciseId) return null
    const [{ value: lastNumber }] = await tx
      .select({ value: max(sets.setNumber) })
      .from(sets)
      .where(eq(sets.workoutExerciseId, exerciseId))
    const setNumber = (lastNumber ?? 0) + 1
    await tx.insert(sets).values({
      workoutExerciseId: exerciseId,
      setNumber,
      reps: patch.reps ?? null,
      weight: patch.weight ?? null,
      completed: patch.completed ?? false,
      ...(patch.setType !== undefined ? { setType: patch.setType } : {}),
    })
    await stampWorkoutCompleted(tx, workoutId)
    return { setNumber }
  })
}

/**
 * Removes one set from an owned exercise and renumbers the higher sets down by
 * one, keeping `setNumber` 1-based and contiguous. Returns null when not owned,
 * the position is absent, or no such set exists.
 */
export async function removeSet(
  userId: string,
  workoutId: string,
  exercisePosition: number,
  setNumber: number,
): Promise<{ removed: true } | null> {
  return db.transaction(async (tx) => {
    const exerciseId = await findOwnedExerciseId(tx, userId, workoutId, exercisePosition)
    if (!exerciseId) return null
    const [deleted] = await tx
      .delete(sets)
      .where(and(eq(sets.workoutExerciseId, exerciseId), eq(sets.setNumber, setNumber)))
      .returning({ id: sets.id })
    if (!deleted) return null
    // Close the gap the removal left so set order stays 1-based contiguous.
    await tx
      .update(sets)
      .set({ setNumber: sql`${sets.setNumber} - 1` })
      .where(and(eq(sets.workoutExerciseId, exerciseId), gt(sets.setNumber, setNumber)))
    await stampWorkoutCompleted(tx, workoutId)
    return { removed: true }
  })
}

/** The metadata `updateWorkoutMeta` can change without touching exercises/sets. */
export interface WorkoutMeta {
  name?: string | null
  startedAt?: Date
}

/**
 * Updates only a workout's name and/or startedAt — no child changes — gated on
 * ownership via the `update ... returning`. Returns null when the patch is empty
 * or the user doesn't own the workout.
 */
export async function updateWorkoutMeta(
  userId: string,
  id: string,
  meta: WorkoutMeta,
): Promise<{ id: string } | null> {
  const values = {
    ...(meta.name !== undefined ? { name: meta.name } : {}),
    ...(meta.startedAt !== undefined ? { startedAt: meta.startedAt } : {}),
  }
  if (Object.keys(values).length === 0) return null
  const [owned] = await db
    .update(workouts)
    .set(values)
    .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
    .returning({ id: workouts.id })
  return owned ?? null
}
