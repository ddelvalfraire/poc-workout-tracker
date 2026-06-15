import { and, asc, count, countDistinct, desc, eq, ne } from 'drizzle-orm'
import type { WorkoutInput } from '@/lib/workout-input'
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

/** Inserts a workout's exercises + sets (shared by saveWorkout and updateWorkout). */
async function insertWorkoutChildren(
  tx: Tx,
  workoutId: string,
  exercises: WorkoutInput['exercises'],
) {
  for (const [position, exercise] of exercises.entries()) {
    const [we] = await tx
      .insert(workoutExercises)
      .values({
        workoutId,
        wgerExerciseId: exercise.wgerExerciseId,
        name: exercise.name,
        position,
      })
      .returning({ id: workoutExercises.id })

    if (exercise.sets.length > 0) {
      await tx.insert(sets).values(
        exercise.sets.map((s, i) => ({
          workoutExerciseId: we.id,
          setNumber: i + 1,
          reps: s.reps,
          weight: s.weight,
        })),
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
      .values({ userId, name: input.name })
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
      .set({ name: input.name ?? null })
      .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
      .returning({ id: workouts.id })
    if (!owned) return null

    await tx.delete(workoutExercises).where(eq(workoutExercises.workoutId, id))
    await insertWorkoutChildren(tx, id, input.exercises)
    return { id }
  })
}
