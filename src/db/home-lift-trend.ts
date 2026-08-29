import 'server-only'
import { cache } from 'react'
import { and, count, desc, eq, gte, inArray, isNotNull, ne } from 'drizzle-orm'
import { db } from '@/db'
import { sets, workoutExercises, workouts } from '@/db/schema'
import { getExerciseStats } from '@/db/exercise-stats'
import { CANONICAL_LIFTS } from '@/lib/trophy-kinds'
import type { ExerciseSource } from '@/lib/exercises/custom-exercise-input'
import { buildLiftTrend, type LiftTrend } from '@/lib/home/lift-trend'

/**
 * The lift-trend widget's read: which lift the section charts, and that
 * lift's e1RM series.
 *
 * A section may PIN a lift (the layout document's config). When it does not —
 * which is every layout until the editor's picker ships — the widget falls
 * back to the lift the user actually trains most. That fallback is what lets
 * the widget be useful on a home nobody has customized.
 */

/** Every wger id that maps to a canonical lift, flattened once at module load
 *  — the scope that keeps the default pick off a full set scan. */
const CANONICAL_WGER_IDS: readonly number[] = Object.values(CANONICAL_LIFTS).flatMap(
  (def) => def.wgerIds,
)

/** How far back the default pick looks. "Most-trained" has to mean most
 *  trained LATELY: a lift untouched for a year is not what home should chart,
 *  and bounding the count is also what keeps this one grouped aggregate
 *  rather than a scan of everything ever logged. */
const DEFAULT_PICK_DAYS = 365
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * The canonical lift with the most completed working sets in the window.
 *
 * Restricted to WGER canonical ids on purpose. A custom exercise can be a
 * canonical lift too, but only by NAME (`canonicalLiftFor`), which SQL cannot
 * match — and admitting every custom exercise so the name check could run in
 * JS would turn a grouped count back into the unbounded scan this avoids.
 * Someone whose squat is a custom exercise pins it explicitly; the automatic
 * default stays cheap.
 *
 * Ties break on the lowest wger id — arbitrary, but STABLE, so home does not
 * silently swap which lift it charts between two equally-trained lifts.
 */
const pickMostTrainedLift = cache(async (userId: string, nowMs: number): Promise<number | null> => {
  const since = new Date(nowMs - DEFAULT_PICK_DAYS * MS_PER_DAY)
  const [row] = await db
    .select({ wgerExerciseId: workoutExercises.wgerExerciseId, setCount: count(sets.id) })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(
      and(
        eq(workouts.userId, userId),
        isNotNull(workouts.completedAt),
        eq(sets.completed, true),
        // Warm-ups are excluded from every other scoring read; a lift you warm
        // up on is not a lift you train.
        ne(sets.setType, 'warmup'),
        eq(workoutExercises.source, 'wger'),
        inArray(workoutExercises.wgerExerciseId, [...CANONICAL_WGER_IDS]),
        gte(workouts.startedAt, since),
      ),
    )
    .groupBy(workoutExercises.wgerExerciseId)
    .orderBy(desc(count(sets.id)), workoutExercises.wgerExerciseId)
    .limit(1)
  return row?.wgerExerciseId ?? null
})

export interface LiftTrendResult extends LiftTrend {
  /** What the widget calls the lift — the exercise's own name. */
  exerciseName: string
  source: ExerciseSource
  wgerExerciseId: number
}

/**
 * The pinned lift's curve, or the most-trained lift's when nothing is pinned.
 *
 * Null — the widget renders nothing — when there is no lift to chart, when
 * the pinned exercise has no stats, or when the series is too short to be a
 * trend. Absence over emptiness: no "log a squat to see this" tile.
 *
 * Arguments are PRIMITIVES so the request-memoized cache actually hits. Two
 * lift-trend sections pinned to the same lift then pay for one read; keying
 * on a config object would miss on every caller.
 */
export const getLiftTrend = cache(
  async (
    userId: string,
    nowMs: number,
    pinnedSource: ExerciseSource | null,
    pinnedWgerExerciseId: number | null,
  ): Promise<LiftTrendResult | null> => {
    const pinned = pinnedSource !== null && pinnedWgerExerciseId !== null
    const source: ExerciseSource = pinned ? pinnedSource : 'wger'
    const wgerExerciseId = pinned ? pinnedWgerExerciseId : await pickMostTrainedLift(userId, nowMs)
    if (wgerExerciseId === null) return null

    const stats = await getExerciseStats(userId, source, wgerExerciseId)
    if (stats === null) return null

    const trend = buildLiftTrend(stats.trend)
    if (trend === null) return null

    return { ...trend, exerciseName: stats.exercise.name, source, wgerExerciseId }
  },
)
