import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { bestScoredSet, effectiveLoadKg, estimate1RM } from '@/lib/one-rep-max'
import type { LoggingType } from '@/lib/workout-input'
import { db } from './index'
import { getBodyweightKg } from './preferences'
import { workouts, workoutExercises, sets } from './schema'

/**
 * Read-only ALL-TIME aggregates for ONE exercise across a user's COMPLETED
 * workouts — records, per-session e1RM trend, and paginated session history.
 *
 * Like `db/program-stats.ts`, this module sits on the authorization boundary:
 * the app has no Postgres row-level security, so every query here filters by
 * `user_id`. Callers (exercise pages, logger sheet, PR detection) must go
 * through these functions rather than joining the tables directly.
 *
 * Exercise identity is the composite (source, id) — a custom exercise's
 * identity id can equal a wger id, and the two must never merge. Scoring only
 * counts sets with `completed = true` inside workouts with `completedAt` set
 * (completed-only is the standing invariant); the session HISTORY, by
 * contrast, shows every set of those workouts — display truth, not scoring
 * truth. All weights stay canonical kg — display converts, this module never
 * does.
 */

/** The flat query shape — one row per set of the exercise, ascending by
 *  session start, then exercise position, then set number. */
export interface ExerciseStatsRow {
  workoutId: string
  startedAt: Date
  reps: number | null
  weight: number | null // kg
  completed: boolean
  metricMode: string
}

/** One record-holding set (kg, full precision; round only at display). */
export interface ExerciseRecordSet {
  workoutId: string
  performedAt: Date
  reps: number
  /** The EFFECTIVE load (see `effectiveLoadKg`) — for weight_reps exercises
   *  this is the stored weight; for bodyweight types it includes bodyweight. */
  weightKg: number
  e1rm: number
}

/** All-time bests. Every field is independent: a rep-fallback-only history
 *  (bodyweight work with no stored bodyweight) has null load records but may
 *  still hold `mostReps`. Ties keep the earliest occurrence, matching
 *  `bestScoredSet`'s strictly-greater policy. */
export interface ExerciseRecords {
  bestE1rm: ExerciseRecordSet | null
  heaviestLoadKg: ExerciseRecordSet | null
  mostReps: { workoutId: string; performedAt: Date; reps: number } | null
  /** Σ reps × weight per session over completed reps_weight sets with BOTH
   *  non-null (same rule as program-stats tonnage). */
  bestSessionVolumeKg: { workoutId: string; performedAt: Date; volumeKg: number } | null
}

/** One session's best e1RM — the chart series. */
export interface ExerciseTrendPoint {
  workoutId: string
  performedAt: Date
  e1rm: number
}

export interface ExerciseAllTimeStats {
  exercise: {
    wgerExerciseId: number
    source: ExerciseSource
    name: string
    loggingType: LoggingType
  }
  /** Distinct completed workouts with ≥1 completed set of this exercise. */
  totalSessions: number
  totalCompletedSets: number
  records: ExerciseRecords
  /** Sparse, ascending by session start: only e1rm-scorable sessions appear. */
  trend: ExerciseTrendPoint[]
}

/** Pagination guard: the module caps its own page size — callers are server
 *  components, but reads still guard their inputs. */
const MAX_SESSIONS_PAGE = 50

/**
 * Pure aggregation over the flat rows — exported for tests. Builds fresh
 * structures throughout; never mutates its inputs. Rows must arrive in
 * ascending session-start order (the query's orderBy) so strictly-greater
 * comparisons keep ties on the earliest session.
 */
export function aggregateExerciseStats(
  rows: readonly ExerciseStatsRow[],
  loggingType: LoggingType,
  // The load basis for bodyweight-type scoring. The CURRENT stored bodyweight
  // scores ALL history — accepted drift, same trade-off as program-stats.
  bodyweightKg: number | null = null,
): Pick<ExerciseAllTimeStats, 'totalSessions' | 'totalCompletedSets' | 'records' | 'trend'> {
  const completedRows = rows.filter((row) => row.completed)

  // Group by session, preserving input (session-start) order.
  const bySession = new Map<string, { performedAt: Date; rows: ExerciseStatsRow[] }>()
  for (const row of completedRows) {
    if (!bySession.has(row.workoutId)) {
      bySession.set(row.workoutId, { performedAt: row.startedAt, rows: [] })
    }
    bySession.get(row.workoutId)!.rows.push(row)
  }

  let bestE1rm: ExerciseRecordSet | null = null
  let heaviestLoadKg: ExerciseRecordSet | null = null
  let mostReps: ExerciseRecords['mostReps'] = null
  let bestSessionVolumeKg: ExerciseRecords['bestSessionVolumeKg'] = null
  const trend: ExerciseTrendPoint[] = []

  for (const [workoutId, session] of bySession) {
    // Load scoring reads only reps_weight-METRIC rows: duration rows carry no
    // load, and duration records are deliberately out of scope here.
    const scorableRows = session.rows.filter((row) => row.metricMode === 'reps_weight')
    const best = bestScoredSet(scorableRows, loggingType, bodyweightKg)
    if (best?.kind === 'e1rm') {
      trend.push({ workoutId, performedAt: session.performedAt, e1rm: best.e1rm })
      if (bestE1rm === null || best.e1rm > bestE1rm.e1rm) {
        bestE1rm = {
          workoutId,
          performedAt: session.performedAt,
          reps: best.reps,
          weightKg: best.weightKg,
          e1rm: best.e1rm,
        }
      }
    }

    let sessionVolume = 0
    for (const row of session.rows) {
      // Every record is reps_weight-gated — nothing in the write path forces
      // reps null on duration rows, so stray reps there must not claim the
      // rep record any more than the load ones.
      if (row.metricMode !== 'reps_weight') continue
      // Same guard as the rep fallback in bestScoredSet: reps must be a
      // positive integer to count as a rep record.
      if (row.reps !== null && Number.isInteger(row.reps) && row.reps >= 1) {
        if (mostReps === null || row.reps > mostReps.reps) {
          mostReps = { workoutId, performedAt: session.performedAt, reps: row.reps }
        }
      }
      const load = effectiveLoadKg(loggingType, row.weight, bodyweightKg)
      const e1rm = estimate1RM(row.reps, load)
      if (e1rm !== null && (heaviestLoadKg === null || (load as number) > heaviestLoadKg.weightKg)) {
        heaviestLoadKg = {
          workoutId,
          performedAt: session.performedAt,
          reps: row.reps as number,
          weightKg: load as number,
          e1rm,
        }
      }
      // Tonnage stays RAW stored weight (not effective load), matching the
      // program-stats rule — and is therefore only meaningful for weight_reps.
      if (row.reps !== null && row.weight !== null) {
        sessionVolume += row.reps * row.weight
      }
    }
    if (
      sessionVolume > 0 &&
      (bestSessionVolumeKg === null || sessionVolume > bestSessionVolumeKg.volumeKg)
    ) {
      bestSessionVolumeKg = { workoutId, performedAt: session.performedAt, volumeKg: sessionVolume }
    }
  }

  return {
    totalSessions: bySession.size,
    totalCompletedSets: completedRows.length,
    records: { bestE1rm, heaviestLoadKg, mostReps, bestSessionVolumeKg },
    trend,
  }
}

/**
 * All-time stats for one exercise, or null when the user has no completed
 * history of it (callers render an empty state, never a zeroed record board).
 */
export async function getExerciseStats(
  userId: string,
  source: ExerciseSource,
  wgerExerciseId: number,
): Promise<ExerciseAllTimeStats | null> {
  const [bodyweightKg, rows] = await Promise.all([
    getBodyweightKg(userId),
    db
      .select({
        workoutId: workouts.id,
        startedAt: workouts.startedAt,
        exerciseName: workoutExercises.name,
        loggingType: workoutExercises.loggingType,
        reps: sets.reps,
        weight: sets.weight,
        completed: sets.completed,
        metricMode: sets.metricMode,
      })
      .from(sets)
      .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
      .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
      .where(
        and(
          eq(workouts.userId, userId),
          eq(workoutExercises.wgerExerciseId, wgerExerciseId),
          eq(workoutExercises.source, source),
          isNotNull(workouts.completedAt),
        ),
      )
      .orderBy(asc(workouts.startedAt), asc(workoutExercises.position), asc(sets.setNumber)),
  ])
  if (rows.length === 0) return null

  // Latest non-null denormalized name wins (renames converge); loggingType
  // follows the same rule so scoring tracks the current setting — the same
  // policy as program-stats. The null guards are defensive-only on this path:
  // unlike program-stats' left joins, the inner join makes both NOT NULL.
  let name = ''
  let loggingType: LoggingType = 'weight_reps'
  for (const row of rows) {
    if (row.exerciseName !== null) name = row.exerciseName
    if (row.loggingType !== null) loggingType = row.loggingType
  }

  return {
    exercise: { wgerExerciseId, source, name, loggingType },
    ...aggregateExerciseStats(rows, loggingType, bodyweightKg),
  }
}

/** One page entry of the exercise's session history — every set shown,
 *  including uncompleted and duration-mode rows (display truth). */
export interface ExerciseSession {
  workoutId: string
  workoutName: string | null
  performedAt: Date
  sets: {
    setNumber: number
    reps: number | null
    weight: number | null // kg
    completed: boolean
    metricMode: string
    durationSec: number | null
    distanceM: number | null
  }[]
}

/**
 * Session-grouped history of one exercise, newest first, paginated. Same
 * scoping as `getExerciseStats` (owner, composite identity, completed
 * workouts only). Two-step like `getLastPerformance`: page the workouts,
 * then fetch their set rows.
 */
export async function getExerciseSessions(
  userId: string,
  source: ExerciseSource,
  wgerExerciseId: number,
  opts: { limit: number; offset: number },
): Promise<ExerciseSession[]> {
  // NaN/Infinity would sail through Math.min/max — normalize first.
  const limit = Number.isFinite(opts.limit)
    ? Math.min(Math.max(1, Math.floor(opts.limit)), MAX_SESSIONS_PAGE)
    : MAX_SESSIONS_PAGE
  const offset = Number.isFinite(opts.offset) ? Math.max(0, Math.floor(opts.offset)) : 0

  const page = await db
    .select({
      workoutId: workouts.id,
      workoutName: workouts.name,
      performedAt: workouts.startedAt,
    })
    .from(workouts)
    .innerJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
    .where(
      and(
        eq(workouts.userId, userId),
        eq(workoutExercises.wgerExerciseId, wgerExerciseId),
        eq(workoutExercises.source, source),
        isNotNull(workouts.completedAt),
      ),
    )
    // groupBy dedupes a workout that holds the exercise twice (two slots →
    // one session entry), the same way listWorkouts collapses its joins.
    .groupBy(workouts.id)
    // The id tiebreaker keeps pagination stable when two sessions share a
    // startedAt — without it, ties can duplicate or drop across pages.
    .orderBy(desc(workouts.startedAt), desc(workouts.id))
    .limit(limit)
    .offset(offset)
  if (page.length === 0) return []

  const setRows = await db
    .select({
      workoutId: workoutExercises.workoutId,
      setNumber: sets.setNumber,
      reps: sets.reps,
      weight: sets.weight,
      completed: sets.completed,
      metricMode: sets.metricMode,
      durationSec: sets.durationSec,
      distanceM: sets.distanceM,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .where(
      and(
        inArray(
          workoutExercises.workoutId,
          page.map((p) => p.workoutId),
        ),
        eq(workoutExercises.wgerExerciseId, wgerExerciseId),
        eq(workoutExercises.source, source),
      ),
    )
    .orderBy(asc(workoutExercises.position), asc(sets.setNumber))

  // Page order (newest first) is the display order; sets group under their
  // session in position/setNumber order from the query.
  return page.map((p) => ({
    workoutId: p.workoutId,
    workoutName: p.workoutName,
    performedAt: p.performedAt,
    sets: setRows
      .filter((s) => s.workoutId === p.workoutId)
      .map((s) => ({
        setNumber: s.setNumber,
        reps: s.reps,
        weight: s.weight,
        completed: s.completed,
        metricMode: s.metricMode,
        durationSec: s.durationSec,
        distanceM: s.distanceM,
      })),
  }))
}
