import { and, countDistinct, desc, eq, gt, isNotNull, sql } from 'drizzle-orm'
import { db } from './index'
import { programDays, programEvents, sets, workoutExercises, workouts } from './schema'
import { getProgramDayDetail } from './programs'
import type { ExerciseSource } from '@/lib/exercises/custom-exercise-input'
import type { SettledDecision } from '@/lib/workout/record-reach'

/**
 * The training max an exercise is CURRENTLY working from, when it was
 * settled, and how much training has happened at it since.
 *
 * Guard 2's settled fact. Losing a personal record to a correction is obvious
 * and expected; a training max quietly NOT following the record down is the
 * one nobody predicts, and the one that makes the app look wrong three weeks
 * later. So the disclosure states it — positively, with the reason it is not
 * being revisited.
 *
 * Every part is READ, never inferred: the value from the exercise's own
 * progression, the date from the `adjust_training_max` event that produced
 * that value (matched on the payload's day and exercise position, so another
 * lift's bump can never lend it a date), the count from the same
 * trained-and-completed predicate the week axis uses. Any part that cannot be
 * established returns null — a half-known settled fact stated confidently is
 * worse than saying nothing at all.
 */

/** The event payload `setTrainingMax` writes. Read defensively: jsonb is
 *  untyped in the database, and an event describing something else must
 *  simply not match. */
function bumpLandedOn(
  payload: unknown,
  dayPosition: number,
  exercisePosition: number,
  trainingMaxKg: number,
): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const record = payload as Record<string, unknown>
  if (record.dayPosition !== dayPosition || record.exercisePosition !== exercisePosition) {
    return false
  }
  const after = record.after
  if (typeof after !== 'object' || after === null) return false
  return (after as Record<string, unknown>).trainingMaxKg === trainingMaxKg
}

/**
 * The settled training max behind one exercise of one session, or null when
 * there is none to defend — an ad-hoc workout, a lift whose progression
 * carries no TM, or a TM whose bump left no event to date it.
 */
export async function settledTrainingMax(
  userId: string,
  workoutId: string,
  source: ExerciseSource,
  wgerExerciseId: number,
): Promise<SettledDecision | null> {
  const [workout] = await db
    .select({ programDayId: workouts.programDayId })
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
  if (!workout?.programDayId) return null

  const day = await getProgramDayDetail(userId, workout.programDayId)
  if (!day) return null

  // Composite identity, as everywhere else: a custom exercise's id can
  // collide with a wger id, and the two must never share a training max.
  const slot = day.exercises.find(
    (exercise) => exercise.source === source && exercise.wgerExerciseId === wgerExerciseId,
  )
  const progression = slot?.progression as { trainingMaxKg?: unknown } | null | undefined
  const valueKg = progression?.trainingMaxKg
  if (slot === undefined || typeof valueKg !== 'number') return null

  // The event that produced THIS value. Scanned rather than filtered in SQL
  // because the match is on jsonb the column has no index for; the log is
  // small, and this runs once, at save-intent.
  const events = await db
    .select({ occurredAt: programEvents.occurredAt, payload: programEvents.payload })
    .from(programEvents)
    .where(
      and(
        eq(programEvents.userId, userId),
        eq(programEvents.programId, day.program.id),
        eq(programEvents.action, 'adjust_training_max'),
      ),
    )
    .orderBy(desc(programEvents.occurredAt))
    .limit(100)
  const bump = events.find((event) =>
    bumpLandedOn(event.payload, day.position, slot.position, valueKg),
  )
  if (!bump) return null

  // Trained AND completed, the same predicate the week axis counts by: a
  // started-but-empty session must not inflate "you've trained N sessions
  // there since" any more than it advances a mesocycle.
  const [since] = await db
    .select({ value: countDistinct(workouts.id) })
    .from(workouts)
    .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
    .where(
      and(
        eq(programDays.programId, day.program.id),
        eq(workouts.userId, userId),
        isNotNull(workouts.completedAt),
        gt(workouts.startedAt, bump.occurredAt),
        sql`exists (
          select 1 from ${workoutExercises}
          inner join ${sets} on ${sets.workoutExerciseId} = ${workoutExercises.id}
          where ${workoutExercises.workoutId} = ${workouts.id} and ${sets.completed}
        )`,
      ),
    )

  return {
    kind: 'trainingMax',
    valueKg,
    decidedAt: bump.occurredAt,
    sessionsSince: since?.value ?? 0,
  }
}
