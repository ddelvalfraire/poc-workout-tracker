import { and, asc, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { AUTOREG_SESSION_WINDOW } from '@/lib/autoregulate'
import { db } from './index'
import { workouts, workoutExercises, sets, programDays } from './schema'

/**
 * History assembly for the auto-regulation engine (see lib/autoregulate.ts):
 * the most recent COMPLETED trained sessions of one program exercise,
 * provenance-scoped to one program. A session testifies only when the workout
 * is finished (`completedAt` set — a live session in the logger must never be
 * evidence on the preview/program-page paths) AND trained (≥1 completed set,
 * the week-axis invariant from `programWeekState`, so ghost instantiations
 * can never testify to a stall). Only `weight_reps` slots qualify:
 * `sets.weight` is a total load only for that logging type, and prescriptions
 * are absolute loads, so nothing else is scorable against them.
 *
 * Each set row carries its prescribed-at-instantiation snapshot
 * (`prescribedLoadKg`/`prescribedRepMin`) — the engine scores actuals against
 * THOSE facts, never against a re-derivation of today's plan. Rows without a
 * snapshot (all pre-snapshot history, ad-hoc adds) are unscorable, so the
 * engine stays silent until post-snapshot sessions accrue (the cold start).
 */

/** One prior program-scoped session of an exercise: identity, its stamped
 *  week, and the logged set rows with their prescription snapshots. */
export interface AutoregHistorySession {
  workoutId: string
  programWeek: number
  sets: {
    setNumber: number
    reps: number | null
    weightKg: number | null
    completed: boolean
    setType: 'working' | 'warmup' | 'backoff' | 'amrap'
    prescribedLoadKg: number | null
    prescribedRepMin: number | null
  }[]
}

/** How many prior sessions the Layer 1 rules consult (the 3-stall window). */
export const AUTOREG_HISTORY_LIMIT = AUTOREG_SESSION_WINDOW

/** Sessions older than this never testify — stale evidence (an injury break,
 *  a long trip) must not carry a stall streak into a rehab return. */
export const AUTOREG_RECENCY_DAYS = 45

export interface AutoregHistoryOptions {
  /** Keeps the session currently being derived-for out of its own history. */
  excludeWorkoutId?: string
  /** The program's deload week: any session stamped with it RESETS stall
   *  memory — only sessions AFTER the most recent deload-week session are
   *  evidence (its 85% loads are a planned back-off, not a stall). */
  deloadWeek?: number | null
}

/**
 * Up to `AUTOREG_HISTORY_LIMIT` most recent completed trained sessions of the
 * exercise (composite identity) within the program, freshest first.
 * Provenance-scoped through `program_days` (workouts carry `programDayId`,
 * not `programId`) and gated on `workouts.userId` — the module's
 * authorization boundary. Ordered by `startedAt` desc with `workouts.id` as
 * tiebreak so midnight-collision backdates can't flap the verdict. One
 * session per calendar day (the latest) — a double-session day must not fill
 * the whole window. A day that repeats the exercise contributes its FIRST
 * slot only (position order), mirroring the logger's first-slot-wins keying.
 */
export async function getRecentTrainedSessions(
  userId: string,
  programId: string,
  source: ExerciseSource,
  wgerExerciseId: number,
  options?: AutoregHistoryOptions,
): Promise<AutoregHistorySession[]> {
  // Same trained predicate as programWeekState: ≥1 completed set anywhere in
  // the workout. Raw sql so the invariant stays a plain readable expression.
  const trainedWorkout = sql`exists (
    select 1 from ${workoutExercises}
    inner join ${sets} on ${sets.workoutExerciseId} = ${workoutExercises.id}
    where ${workoutExercises.workoutId} = ${workouts.id} and ${sets.completed}
  )`

  const recencyCutoff = new Date(Date.now() - AUTOREG_RECENCY_DAYS * 24 * 60 * 60 * 1000)

  const slots = await db
    .select({
      workoutId: workouts.id,
      programWeek: workouts.programWeek,
      startedAt: workouts.startedAt,
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
        isNotNull(workouts.completedAt),
        gte(workouts.startedAt, recencyCutoff),
        options?.excludeWorkoutId ? ne(workouts.id, options.excludeWorkoutId) : undefined,
        trainedWorkout,
      ),
    )
    .orderBy(desc(workouts.startedAt), desc(workouts.id), asc(workoutExercises.position))

  // First slot per workout, newest first — ALL candidates, because the deload
  // boundary below must be able to see past the window before truncating.
  const perWorkout: {
    workoutId: string
    programWeek: number
    startedAt: Date
    workoutExerciseId: string
  }[] = []
  for (const slot of slots) {
    if (perWorkout.some((c) => c.workoutId === slot.workoutId)) continue
    if (slot.programWeek === null) continue // isNotNull already guarantees; narrows the type
    perWorkout.push({ ...slot, programWeek: slot.programWeek })
  }

  // Deload boundary: the first (most recent) deload-week session resets the
  // streak — it and everything older are dropped.
  const deloadWeek = options?.deloadWeek ?? null
  const boundary =
    deloadWeek === null ? -1 : perWorkout.findIndex((c) => c.programWeek === deloadWeek)
  const sinceDeload = boundary === -1 ? perWorkout : perWorkout.slice(0, boundary)

  // One session per calendar day, keeping the latest (rows are newest-first).
  const seenDays = new Set<string>()
  const chosen: typeof perWorkout = []
  for (const candidate of sinceDeload) {
    if (chosen.length >= AUTOREG_HISTORY_LIMIT) break
    const day = candidate.startedAt.toISOString().slice(0, 10)
    if (seenDays.has(day)) continue
    seenDays.add(day)
    chosen.push(candidate)
  }
  if (chosen.length === 0) return []

  const setRows = await db
    .select({
      workoutExerciseId: sets.workoutExerciseId,
      setNumber: sets.setNumber,
      reps: sets.reps,
      weightKg: sets.weight,
      completed: sets.completed,
      setType: sets.setType,
      prescribedLoadKg: sets.prescribedLoadKg,
      prescribedRepMin: sets.prescribedRepMin,
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
        setNumber: r.setNumber,
        reps: r.reps,
        weightKg: r.weightKg,
        completed: r.completed,
        setType: r.setType,
        prescribedLoadKg: r.prescribedLoadKg,
        prescribedRepMin: r.prescribedRepMin,
      })),
  }))
}
