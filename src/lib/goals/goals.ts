import { cache } from 'react'
import {
  activeScheduledWeekdays,
  completedWorkoutTimes,
  listActiveGoals,
  markGoalAchieved,
  type GoalRow,
} from '@/db/goals'
import { getExerciseStats } from '@/db/exercise-stats'
import { getBodyweightKg, getWeightUnit } from '@/db/preferences'
import { getMessages } from '@/i18n/translate'
import type { ExerciseSource } from '@/lib/exercises/custom-exercise-input'
import type { GoalKind } from '@/lib/goals/goal-input'
import {
  bodyweightRemainingKg,
  goalLabel,
  isBodyweightAchieved,
  isConsistencyAchieved,
  isStrengthAchieved,
  paceProjection,
  strengthPercent,
  weeklyStreak,
} from '@/lib/goals/goal-progress'
import { sendPushToUser } from '@/lib/push'

/**
 * Goal composition over the db reads: progress evaluation for the surfaces
 * (goals page, home, MCP) and the fails-soft achievement seam. Goals are
 * facts about targets — every number here is read from truths the app
 * already computes (exercise-stats records/trend, the denormalized current
 * bodyweight, completed workouts vs the active program's scheduled
 * weekdays); this module never writes anything except the achievedAt fact.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000
// Streak evidence window: the 104-week goal ceiling plus slack so a maximal
// streak can still be proven from the fetched completions.
const STREAK_LOOKBACK_DAYS = 106 * 7

export type GoalProgress =
  | {
      kind: 'strength'
      /** All-time best est. 1RM (kg) of the goal's exercise, or null. */
      bestE1rmKg: number | null
      percent: number
      /** "On pace for {date}" — null means silence (see paceProjection). */
      projectedAt: Date | null
    }
  | {
      kind: 'bodyweight'
      currentKg: number | null
      /** Kg left in the target's direction; null when no bodyweight logged. */
      remainingKg: number | null
    }
  | {
      kind: 'consistency'
      /** SERVER-computed streak (UTC weeks) — display surfaces recompute
       *  client-side; this value feeds achievement and the MCP payload. */
      streakWeeks: number
      targetWeeks: number
      allowedMissesPerWeek: number
      scheduledWeekdays: number[]
    }

export interface GoalWithProgress {
  goal: GoalRow
  progress: GoalProgress
  /** achievedAt already recorded, OR the live predicate holds right now. */
  achieved: boolean
}

/**
 * Evaluates every active goal's progress. Evidence is fetched once per
 * distinct need: one stats read per unique strength exercise, one bodyweight
 * read, one schedule+completions read for all consistency goals.
 */
export async function evaluateGoalProgress(
  userId: string,
  now: Date = new Date(),
): Promise<GoalWithProgress[]> {
  const goals = await listActiveGoals(userId)
  if (goals.length === 0) return []

  const needsBodyweight = goals.some((g) => g.kind === 'bodyweight')
  const needsConsistency = goals.some((g) => g.kind === 'consistency')
  const strengthKeys = new Map<string, { source: ExerciseSource; wgerExerciseId: number }>()
  for (const goal of goals) {
    if (goal.kind === 'strength' && goal.source !== null && goal.wgerExerciseId !== null) {
      strengthKeys.set(`${goal.source}:${goal.wgerExerciseId}`, {
        source: goal.source,
        wgerExerciseId: goal.wgerExerciseId,
      })
    }
  }

  const since = new Date(now.getTime() - STREAK_LOOKBACK_DAYS * MS_PER_DAY)
  const [statsEntries, bodyweightKg, scheduledWeekdays, completions] = await Promise.all([
    Promise.all(
      [...strengthKeys.entries()].map(async ([key, ref]) => {
        const stats = await getExerciseStats(userId, ref.source, ref.wgerExerciseId)
        return [key, stats] as const
      }),
    ),
    needsBodyweight ? getBodyweightKg(userId) : Promise.resolve(null),
    needsConsistency ? activeScheduledWeekdays(userId) : Promise.resolve([]),
    needsConsistency ? completedWorkoutTimes(userId, since) : Promise.resolve([]),
  ])
  const statsByKey = new Map(statsEntries)

  return goals.map((goal) => {
    if (goal.kind === 'strength' && 'e1rmKg' in goal.target) {
      const stats = statsByKey.get(`${goal.source}:${goal.wgerExerciseId}`) ?? null
      const bestE1rmKg = stats?.records.bestE1rm?.e1rm ?? null
      const trendPoints = (stats?.trend ?? []).map((p) => ({ at: p.performedAt, value: p.e1rm }))
      return {
        goal,
        progress: {
          kind: 'strength' as const,
          bestE1rmKg,
          percent: strengthPercent(bestE1rmKg, goal.target.e1rmKg),
          projectedAt: paceProjection(trendPoints, goal.target.e1rmKg, now),
        },
        achieved: goal.achievedAt !== null || isStrengthAchieved(bestE1rmKg, goal.target.e1rmKg),
      }
    }
    if (goal.kind === 'bodyweight' && 'weightKg' in goal.target) {
      return {
        goal,
        progress: {
          kind: 'bodyweight' as const,
          currentKg: bodyweightKg,
          remainingKg: bodyweightRemainingKg(bodyweightKg, goal.target),
        },
        achieved: goal.achievedAt !== null || isBodyweightAchieved(bodyweightKg, goal.target),
      }
    }
    if (goal.kind === 'consistency' && 'targetWeeks' in goal.target) {
      const streakWeeks = weeklyStreak({
        scheduledWeekdays,
        completions,
        allowedMissesPerWeek: goal.target.allowedMissesPerWeek,
        now,
      })
      return {
        goal,
        progress: {
          kind: 'consistency' as const,
          streakWeeks,
          targetWeeks: goal.target.targetWeeks,
          allowedMissesPerWeek: goal.target.allowedMissesPerWeek,
          scheduledWeekdays,
        },
        achieved: goal.achievedAt !== null || isConsistencyAchieved(streakWeeks, goal.target),
      }
    }
    // Corrupt kind/target pairing (jsonb is app-validated only): surface the
    // row without claiming progress — silence over corruption.
    return {
      goal,
      progress: { kind: 'bodyweight' as const, currentKg: null, remainingKg: null },
      achieved: goal.achievedAt !== null,
    }
  })
}

/**
 * The achievement seam: called after a workout save (strength/consistency)
 * and after a bodyweight log write (bodyweight). Fails SOFT — the parent
 * write already committed and must never fail because a goal check did.
 * Idempotent end-to-end: markGoalAchieved's IS NULL predicate stamps once,
 * and the push rides only a successful first stamp.
 */
export async function checkGoalAchievements(
  userId: string,
  kinds: readonly GoalKind[],
): Promise<void> {
  try {
    const evaluated = await evaluateGoalProgress(userId)
    const newlyAchieved = evaluated.filter(
      (e) => kinds.includes(e.goal.kind) && e.goal.achievedAt === null && e.achieved,
    )
    if (newlyAchieved.length === 0) return
    const [unit, t] = await Promise.all([getWeightUnit(userId), getMessages('Goals')])
    for (const { goal } of newlyAchieved) {
      const marked = await markGoalAchieved(userId, goal.id)
      if (marked === null) continue // raced: someone else stamped it — no double push
      const label = goalLabel(goal, unit)
      await sendPushToUser(userId, {
        title: t('push.title', { name: t(label.key, label.values) }),
        body: t('push.body'),
        url: '/goals',
      })
    }
  } catch (error) {
    // Fails soft: the triggering write is the source of truth.
    console.error('goal achievement check failed (parent write unaffected)', error)
  }
}

/** The client streak surfaces' evidence: completions as epoch ms (stable RSC
 *  serialization) + the active program's scheduled weekdays. Goal-independent
 *  — each consistency goal applies its OWN grace to the same evidence. */
export interface StreakEvidence {
  completedAtTimes: number[]
  scheduledWeekdays: number[]
}

/** One evidence read shared by the home chip and the goals page cards. */
export async function getStreakEvidence(
  userId: string,
  now: Date = new Date(),
): Promise<StreakEvidence> {
  const since = new Date(now.getTime() - STREAK_LOOKBACK_DAYS * MS_PER_DAY)
  const [scheduledWeekdays, completions] = await Promise.all([
    activeScheduledWeekdays(userId),
    completedWorkoutTimes(userId, since),
  ])
  return { completedAtTimes: completions.map((d) => d.getTime()), scheduledWeekdays }
}

/** What the home page's quiet goals row needs, or null when no active goals. */
export interface GoalsHomeSummary {
  activeCount: number
  /** The newest unachieved goal, or (all achieved) the newest goal. */
  topGoal: GoalRow | null
  /** Present only when a consistency goal exists — the client streak chip's
   *  evidence (epoch ms for stable RSC serialization). */
  streak: {
    completedAtTimes: number[]
    scheduledWeekdays: number[]
    allowedMissesPerWeek: number
  } | null
}

/**
 * The home page's one goals read: active goals plus, when a consistency goal
 * exists, the streak evidence for the CLIENT-side chip ("today"/weeks are the
 * user's calendar, not the server's — the local-day.ts principle).
 *
 * Request-memoized (React cache — per-request only, never cross-request).
 * CONSTRAINT: `nowMs` is epoch ms, NOT a Date — cache keys args by Object.is,
 * and a fresh Date object per call would defeat memoization. Callers sharing
 * one request should omit it (key = userId alone; "now" resolves once, on
 * cache miss) or pass the same primitive.
 */
export const getGoalsHomeSummary = cache(async (
  userId: string,
  nowMs?: number,
): Promise<GoalsHomeSummary | null> => {
  const now = nowMs === undefined ? new Date() : new Date(nowMs)
  const goals = await listActiveGoals(userId)
  if (goals.length === 0) return null
  const consistency = goals.find((g) => g.kind === 'consistency')
  let streak: GoalsHomeSummary['streak'] = null
  if (consistency && 'allowedMissesPerWeek' in consistency.target) {
    const evidence = await getStreakEvidence(userId, now)
    streak = {
      ...evidence,
      allowedMissesPerWeek: consistency.target.allowedMissesPerWeek,
    }
  }
  return {
    activeCount: goals.length,
    topGoal: goals.find((g) => g.achievedAt === null) ?? goals[0] ?? null,
    streak,
  }
})
