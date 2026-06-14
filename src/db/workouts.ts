import { and, asc, count, countDistinct, desc, eq } from 'drizzle-orm'
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

    for (const [position, exercise] of input.exercises.entries()) {
      const [we] = await tx
        .insert(workoutExercises)
        .values({
          workoutId: workout.id,
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

    return { id: workout.id }
  })
}
