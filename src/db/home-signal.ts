import 'server-only'
import { cache } from 'react'
import { and, desc, eq, gte, isNotNull, isNull, ne } from 'drizzle-orm'
import { db } from '@/db'
import { goals, programs, sets, workoutExercises, workouts } from '@/db/schema'
import { buildMuscleResolver } from '@/db/muscle-volume'
import { getHomeLayout, hasStoredHomeLayout } from '@/db/preferences'
import type { ResolvedHomeSection } from '@/lib/home/layout'
import type { BodyweightTarget } from '@/lib/goal-input'
import {
  aggregateTrainingFacts,
  classifyTrainingSignal,
  defaultLayoutFor,
  SIGNAL_WINDOW_WEEKS,
  type SignalSetRow,
  type StatedFacts,
  type TrainingSignal,
} from '@/lib/home/signal'

/**
 * The derived read behind "what we read from your training".
 *
 * THE FIREWALL, at the query level: every column below is a training fact or
 * a stated intention. Nothing here touches a home interaction — because there
 * is no such table to touch. Home stores what you SEE, never what you tapped
 * to see it, which is what makes the firewall a property of the schema rather
 * than a promise in a comment.
 *
 * Nothing is persisted. The verdict is recomputed per request and never
 * written back, so a saved layout can never be quietly overwritten by a read
 * that changed its mind.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WINDOW_MS = SIGNAL_WINDOW_WEEKS * 7 * MS_PER_DAY

/** The active program's diet phase, when one is set. */
const getDietPhase = cache(async (userId: string): Promise<'cutting' | 'bulking' | null> => {
  const [row] = await db
    .select({ phase: programs.dietPhase })
    .from(programs)
    .where(and(eq(programs.userId, userId), eq(programs.status, 'active')))
    .orderBy(desc(programs.createdAt))
    .limit(1)
  return row?.phase === 'cutting' || row?.phase === 'bulking' ? row.phase : null
})

/**
 * What the user has SAID they are doing: an active bodyweight goal's
 * direction, and whether any strength target is open.
 *
 * Achieved and archived goals are excluded. A cut you finished last spring is
 * not a statement about this week, and reading it as one is how a stale
 * intention outlives itself.
 */
const getStatedGoals = cache(async (userId: string): Promise<Omit<StatedFacts, 'dietPhase'>> => {
  const rows = await db
    .select({ kind: goals.kind, target: goals.target })
    .from(goals)
    .where(and(eq(goals.userId, userId), isNull(goals.achievedAt), isNull(goals.archivedAt)))
    .orderBy(desc(goals.createdAt))

  let bodyweightGoalDirection: 'down' | 'up' | null = null
  let hasStrengthGoal = false
  for (const row of rows) {
    if (row.kind === 'strength') {
      hasStrengthGoal = true
      continue
    }
    // Newest first, so the first bodyweight goal seen is the current one.
    if (row.kind === 'bodyweight' && bodyweightGoalDirection === null) {
      const direction = (row.target as BodyweightTarget).direction
      if (direction === 'down' || direction === 'up') bodyweightGoalDirection = direction
    }
  }
  return { bodyweightGoalDirection, hasStrengthGoal }
})

/**
 * Completed working sets in the window, with the columns the classification
 * reads.
 *
 * Bounded by time rather than by exercise, because the question is about the
 * shape of a training block as a whole — which is also what keeps it
 * affordable: eight weeks of sets, not a career's worth.
 */
const fetchSignalRows = cache(async (userId: string, nowMs: number) => {
  const since = new Date(nowMs - WINDOW_MS)
  const rows = await db
    .select({
      reps: sets.reps,
      metricMode: sets.metricMode,
      source: workoutExercises.source,
      wgerExerciseId: workoutExercises.wgerExerciseId,
      exerciseName: workoutExercises.name,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(
      and(
        eq(workouts.userId, userId),
        isNotNull(workouts.completedAt),
        eq(sets.completed, true),
        // Warm-ups describe nothing about how someone trains — the same
        // exclusion every other scoring read applies.
        ne(sets.setType, 'warmup'),
        gte(workouts.startedAt, since),
      ),
    )

  return rows
})

/**
 * The layout home should render — the order of authority, in one place.
 *
 *   saved layout  >  derived read  >  general default
 *
 * A layout you saved wins forever and short-circuits before the signal is
 * ever computed, so someone who has customized their home pays nothing for a
 * read that could not change anything. Only a home nobody has touched asks
 * what the training data suggests, and a signal that reads nothing lands on
 * the general preset.
 *
 * The seed is NEVER written back. Tomorrow's read may suggest something else
 * and should be free to; persisting it here would silently manufacture the
 * "saved layout" that outranks it.
 */
export const getSeededHomeLayout = cache(
  async (userId: string, nowMs: number): Promise<ResolvedHomeSection[]> => {
    const [layout, isSaved] = await Promise.all([
      getHomeLayout(userId),
      hasStoredHomeLayout(userId),
    ])
    if (isSaved) return layout
    return defaultLayoutFor(await getTrainingSignal(userId, nowMs))
  },
)

/**
 * The app's read of how this person trains, or null when the facts describe
 * nothing.
 *
 * Request-memoized on primitives so the editor pays for it once. `nowMs` is
 * the request's own instant, passed in rather than read here, so the window
 * cannot shift between two reads inside one render.
 */
export const getTrainingSignal = cache(
  async (userId: string, nowMs: number): Promise<TrainingSignal | null> => {
    const [dietPhase, statedGoals, rows, musclesFor] = await Promise.all([
      getDietPhase(userId),
      getStatedGoals(userId),
      fetchSignalRows(userId, nowMs),
      // Muscles live in the exercise CATALOG, not on the logged row — the
      // same resolver muscle-volume builds, so both surfaces credit a set to
      // the same groups.
      buildMuscleResolver(userId),
    ])
    const facts: SignalSetRow[] = rows.map((row) => ({
      reps: row.reps,
      metricMode: row.metricMode,
      source: row.source,
      wgerExerciseId: row.wgerExerciseId,
      // The denormalized name is nullable in the schema; canonical-lift
      // matching needs a string, and '' matches no lift.
      exerciseName: row.exerciseName ?? '',
      muscles: musclesFor(row.source, row.wgerExerciseId)?.primary ?? null,
    }))
    return classifyTrainingSignal(aggregateTrainingFacts(facts, { dietPhase, ...statedGoals }))
  },
)
