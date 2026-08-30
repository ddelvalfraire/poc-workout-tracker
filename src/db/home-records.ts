import 'server-only'
import { cache } from 'react'
import { and, asc, eq, gte, inArray, isNotNull, or } from 'drizzle-orm'
import { db } from '@/db'
import { sets, workoutExercises, workouts } from '@/db/schema'
import { getBodyweightKg } from '@/db/preferences'
import { inWindow, volumeWindows } from '@/lib/stats/volume-window'
import { CANONICAL_LIFTS } from '@/lib/goals/trophy-kinds'
import {
  aggregateBigThree,
  aggregateCardioRecords,
  aggregateDistanceWeek,
  type BigThree,
  type CardioRecords,
  type DistanceWeek,
  type RecordSetRow,
} from '@/lib/home/records'

/**
 * The home record widgets' reads. Each is ONE flat query plus a pure
 * aggregator (lib/home/records.ts) — the shape muscle-volume and
 * exercise-stats already use, so the judgement stays testable without a
 * database.
 *
 * All three are request-memoized (React cache, per-request only), and keyed
 * by scope — so a home showing both cardio widgets pays for one query, not
 * two, while the lifts scan stays separate and narrow.
 */

/** Every wger id that maps to a canonical lift, flattened once at module
 *  load. Custom exercises match by NAME, which SQL cannot do, so they are
 *  admitted wholesale and filtered in the aggregator. */
const CANONICAL_WGER_IDS: readonly number[] = Object.values(CANONICAL_LIFTS).flatMap(
  (def) => def.wgerIds,
)

/**
 * Completed sets with the columns any record needs.
 *
 * `narrow` is what keeps this affordable. An unbounded scan would read every
 * set the user has ever logged on every home render — for a long-time account
 * that is tens of thousands of rows to find three numbers. Each caller passes
 * the predicate that bounds it to rows it could possibly care about:
 *   'lifts'  — only exercises that can BE a canonical lift
 *   'cardio' — only sets carrying a duration or a distance
 * `since` bounds it by time on top, for the windowed caller.
 */
type RecordScope = 'lifts' | 'cardio'

const fetchRecordRows = cache(
  async (userId: string, scope: RecordScope, since?: Date): Promise<RecordSetRow[]> => {
    const scopeFilter =
      scope === 'lifts'
        ? // Canonical wger ids, or any custom exercise (name-matched later).
          or(
            inArray(workoutExercises.wgerExerciseId, [...CANONICAL_WGER_IDS]),
            eq(workoutExercises.source, 'custom'),
          )
        : or(isNotNull(sets.durationSec), isNotNull(sets.distanceM))
    const rows = await db
      .select({
        workoutId: workouts.id,
        performedAt: workouts.startedAt,
        source: workoutExercises.source,
        wgerExerciseId: workoutExercises.wgerExerciseId,
        exerciseName: workoutExercises.name,
        loggingType: workoutExercises.loggingType,
        reps: sets.reps,
        weight: sets.weight,
        durationSec: sets.durationSec,
        distanceM: sets.distanceM,
      })
      .from(sets)
      .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
      .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
      .where(
        and(
          eq(workouts.userId, userId),
          isNotNull(workouts.completedAt),
          eq(sets.completed, true),
          scopeFilter,
          ...(since ? [gte(workouts.startedAt, since)] : []),
        ),
      )
      // Ascending so strictly-greater comparisons keep a tie on the earliest
      // set — the record belongs to whoever got there first.
      .orderBy(asc(workouts.startedAt), asc(workoutExercises.position), asc(sets.setNumber))

    return rows.map((r) => ({
      ...r,
      // The denormalized name is nullable in the schema; canonical-lift
      // matching needs a string, and '' simply matches no lift.
      exerciseName: r.exerciseName ?? '',
      loggingType: r.loggingType ?? 'weight_reps',
    }))
  },
)

/** The lifts row scan, shared with the strength-retention read so a home
 *  showing both widgets pays for one query. */
export const fetchLiftRows = (userId: string) => fetchRecordRows(userId, 'lifts')

/** Best e1RM per canonical lift, plus the three-lift total. */
export const getBigThree = cache(async (userId: string): Promise<BigThree> => {
  const [rows, bodyweightKg] = await Promise.all([
    fetchRecordRows(userId, 'lifts'),
    getBodyweightKg(userId),
  ])
  return aggregateBigThree(rows, bodyweightKg)
})

/** All-time conditioning records across every exercise. */
export const getCardioRecords = cache(async (userId: string): Promise<CardioRecords> => {
  return aggregateCardioRecords(await fetchRecordRows(userId, 'cardio'))
})

/**
 * Rolling-window distance totals. Shares the windowing helper the volume
 * totals use, so "this week" means the same thing in both widgets.
 */
export const getDistanceWeek = cache(async (userId: string): Promise<DistanceWeek | null> => {
  const windows = volumeWindows('rolling', new Date())
  const rows = await fetchRecordRows(userId, 'cardio', windows.previous.start)
  let currentM = 0
  let previousM = 0
  for (const row of rows) {
    if (row.distanceM === null || row.distanceM <= 0) continue
    if (inWindow(row.performedAt, windows.current)) currentM += row.distanceM
    else if (inWindow(row.performedAt, windows.previous)) previousM += row.distanceM
  }
  return aggregateDistanceWeek(currentM, previousM)
})
