import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { db } from './index'
import { workouts, workoutExercises, sets, programDays } from './schema'

/**
 * History assembly for the auto-regulation engine (see lib/autoregulate.ts):
 * the most recent TRAINED sessions of one program exercise, provenance-scoped
 * to one program. "Trained" is the week-axis invariant from `programWeekState`
 * — ≥1 completed set in the workout — so ghost instantiations (seeded, never
 * lifted) can never testify to a stall. Only `weight_reps` slots qualify:
 * `sets.weight` is a total load only for that logging type, and prescriptions
 * are absolute loads, so nothing else is scorable against them.
 */

/** One prior program-scoped session of an exercise: its stamped week (the key
 *  to re-deriving what was prescribed) and the logged set rows. */
export interface AutoregHistorySession {
  workoutId: string
  programWeek: number
  sets: {
    reps: number | null
    weightKg: number | null
    completed: boolean
    setType: 'working' | 'warmup'
  }[]
}

/** How many prior sessions the Layer 1 rules consult (latest + previous). */
export const AUTOREG_HISTORY_LIMIT = 2

/**
 * Up to `AUTOREG_HISTORY_LIMIT` most recent trained sessions of the exercise
 * (composite identity) within the program, freshest first. Provenance-scoped
 * through `program_days` (workouts carry `programDayId`, not `programId`) and
 * gated on `workouts.userId` — the module's authorization boundary.
 * `excludeWorkoutId` keeps the session currently being derived-for out of its
 * own history. A day that repeats the exercise contributes its FIRST slot
 * only (position order), mirroring the logger's first-slot-wins keying.
 */
export async function getRecentTrainedSessions(
  userId: string,
  programId: string,
  source: ExerciseSource,
  wgerExerciseId: number,
  excludeWorkoutId?: string,
): Promise<AutoregHistorySession[]> {
  // Same trained predicate as programWeekState: ≥1 completed set anywhere in
  // the workout. Raw sql so the invariant stays a plain readable expression.
  const trainedWorkout = sql`exists (
    select 1 from ${workoutExercises}
    inner join ${sets} on ${sets.workoutExerciseId} = ${workoutExercises.id}
    where ${workoutExercises.workoutId} = ${workouts.id} and ${sets.completed}
  )`

  const slots = await db
    .select({
      workoutId: workouts.id,
      programWeek: workouts.programWeek,
      workoutExerciseId: workoutExercises.id,
    })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
    .where(
      and(
        eq(workouts.userId, userId),
        eq(programDays.programId, programId),
        eq(workoutExercises.wgerExerciseId, wgerExerciseId),
        eq(workoutExercises.source, source),
        eq(workoutExercises.loggingType, 'weight_reps'),
        isNotNull(workouts.programWeek),
        excludeWorkoutId ? ne(workouts.id, excludeWorkoutId) : undefined,
        trainedWorkout,
      ),
    )
    .orderBy(desc(workouts.startedAt), asc(workoutExercises.position))

  // First slot per workout, newest first, capped at the rules' window.
  const chosen: { workoutId: string; programWeek: number; workoutExerciseId: string }[] = []
  for (const slot of slots) {
    if (chosen.length >= AUTOREG_HISTORY_LIMIT) break
    if (chosen.some((c) => c.workoutId === slot.workoutId)) continue
    if (slot.programWeek === null) continue // isNotNull already guarantees; narrows the type
    chosen.push({ ...slot, programWeek: slot.programWeek })
  }
  if (chosen.length === 0) return []

  const setRows = await db
    .select({
      workoutExerciseId: sets.workoutExerciseId,
      reps: sets.reps,
      weightKg: sets.weight,
      completed: sets.completed,
      setType: sets.setType,
    })
    .from(sets)
    .where(
      inArray(
        sets.workoutExerciseId,
        chosen.map((c) => c.workoutExerciseId),
      ),
    )
    .orderBy(asc(sets.setNumber))

  return chosen.map((c) => ({
    workoutId: c.workoutId,
    programWeek: c.programWeek,
    sets: setRows
      .filter((r) => r.workoutExerciseId === c.workoutExerciseId)
      .map((r) => ({
        reps: r.reps,
        weightKg: r.weightKg,
        completed: r.completed,
        setType: r.setType,
      })),
  }))
}
