import 'server-only'
import { cache } from 'react'
import { and, asc, desc, eq, gte, isNotNull, or } from 'drizzle-orm'
import { db } from '@/db'
import { programs, sets, workoutExercises, workouts } from '@/db/schema'
import { getBodyweightKg } from '@/db/preferences'
import { fetchLiftRows } from '@/db/home-records'
import {
  aggregatePlanAdherence,
  aggregateStrengthRetention,
  type PlanAdherence,
  type StrengthRetention,
} from '@/lib/home/adherence'

/**
 * Reads for the two widgets that needed derivations nobody had written:
 * strength retention across a diet phase, and adherence to a prescription.
 */

/** How far back adherence looks. Four weeks is a training block's rough
 *  length without needing to resolve real block boundaries, which depend on
 *  program week state and would cost another read; the copy says "4 weeks"
 *  rather than "this block" so the number and the label agree. */
const ADHERENCE_DAYS = 28
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * The active program's diet-phase anchor — the instant the phase was last
 * set. Null unless a phase is actually set, which is what gates the whole
 * retention widget: without a phase there is nothing to hold strength
 * ACROSS.
 */
const getDietPhaseAnchor = cache(
  async (userId: string): Promise<{ phase: string; setAt: Date } | null> => {
    const [row] = await db
      .select({ phase: programs.dietPhase, setAt: programs.dietPhaseSetAt })
      .from(programs)
      .where(and(eq(programs.userId, userId), eq(programs.status, 'active')))
      .orderBy(desc(programs.createdAt))
      .limit(1)
    if (!row?.phase || !row.setAt) return null
    return { phase: row.phase, setAt: row.setAt }
  },
)

export interface StrengthRetentionResult extends StrengthRetention {
  /** The phase the comparison is anchored to, so the copy can name it. */
  phase: string
  since: Date
}

/**
 * Best e1RM per canonical lift since the diet phase began, against the best
 * before it. Reuses the lifts row scan the big-three read already performs,
 * so on a home showing both widgets this costs no extra query.
 */
export const getStrengthRetention = cache(
  async (userId: string): Promise<StrengthRetentionResult | null> => {
    const anchor = await getDietPhaseAnchor(userId)
    if (anchor === null) return null
    const [rows, bodyweightKg] = await Promise.all([fetchLiftRows(userId), getBodyweightKg(userId)])
    const retention = aggregateStrengthRetention(rows, anchor.setAt, bodyweightKg)
    return retention === null ? null : { ...retention, phase: anchor.phase, since: anchor.setAt }
  },
)

/**
 * Prescribed sets met over the last four weeks. Only sets that CARRIED a
 * prescription are fetched — a set nobody planned is not evidence about a
 * plan, so filtering in SQL keeps the scan proportional to programmed
 * training rather than to everything logged.
 */
export const getPlanAdherence = cache(async (userId: string): Promise<PlanAdherence | null> => {
  const since = new Date(Date.now() - ADHERENCE_DAYS * MS_PER_DAY)
  const rows = await db
    .select({
      prescribedLoadKg: sets.prescribedLoadKg,
      prescribedRepMin: sets.prescribedRepMin,
      weight: sets.weight,
      reps: sets.reps,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(
      and(
        eq(workouts.userId, userId),
        isNotNull(workouts.completedAt),
        eq(sets.completed, true),
        gte(workouts.startedAt, since),
        or(isNotNull(sets.prescribedLoadKg), isNotNull(sets.prescribedRepMin)),
      ),
    )
    .orderBy(asc(workouts.startedAt))
  return aggregatePlanAdherence(rows)
})
