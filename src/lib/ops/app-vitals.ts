/**
 * First-party app vitals for the ops board — the one panel that reads OUR
 * Postgres rather than a vendor API. Unlike the rest of the db layer these
 * are cross-user admin aggregates (no userId scope): the operator is looking
 * at the whole system, not one account.
 *
 * Every query is a cheap indexed count, a day-bucketed aggregate over a
 * 14-day slice, or a tiny newest-first feed; nothing scans unbounded. The DB
 * is core infrastructure, so there is no 'unconfigured' state — a failure is
 * 'unavailable' (fails soft like every other ops source, never throwing into
 * the page).
 *
 * Server-only: never import from a Client Component.
 */
import { and, count, countDistinct, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  goals,
  programEvents,
  programs,
  pushSubscriptions,
  sets,
  workoutExercises,
  workouts,
} from '@/db/schema'
import { fillDailySeries, type DayPoint } from './series'
import type { OpsResult } from './types'

/** How far back "active" and "completed" headline windows reach. */
const ACTIVE_WINDOW_DAYS = 7
/** The product panel's chart window. */
const SERIES_WINDOW_DAYS = 14
const RECENT_EVENTS_LIMIT = 10
const RECENT_WORKOUTS_LIMIT = 5

/** One change-log line, cross-user (the ops view isn't scoped to an owner). */
export interface RecentEvent {
  actor: string
  summary: string
  occurredAt: Date
}

/** One recently completed session for the product panel's feed. */
export interface RecentWorkout {
  name: string | null
  startedAt: Date
  /** Σ reps × weight kg (duration/distance sets contribute 0), whole-session. */
  volumeKg: number
}

export interface AppVitals {
  workoutsCompleted7d: number
  activeUsers7d: number
  pushSubscriptions: number
  activeGoals: number
  pendingProposals: number
  /** Dense ascending 14-day series (zero-filled): completed workouts per day. */
  workoutsPerDay: DayPoint[]
  /** Dense ascending 14-day series (zero-filled): distinct active users per day. */
  activeUsersPerDay: DayPoint[]
  recentEvents: RecentEvent[]
  recentWorkouts: RecentWorkout[]
}

function windowStart(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export async function getAppVitals(): Promise<OpsResult<AppVitals>> {
  try {
    const since = windowStart(ACTIVE_WINDOW_DAYS)
    const seriesSince = windowStart(SERIES_WINDOW_DAYS)
    // UTC calendar-day bucket — matches fillDailySeries' "YYYY-MM-DD" keys.
    const completedDay = sql<string>`to_char(${workouts.completedAt} at time zone 'utc', 'YYYY-MM-DD')`

    const [
      completedRows,
      usersRows,
      pushRows,
      goalsRows,
      proposalsRows,
      workoutsPerDayRows,
      activeUsersPerDayRows,
      recentEvents,
      recentWorkouts,
    ] = await Promise.all([
      db.select({ value: count() }).from(workouts).where(gte(workouts.completedAt, since)),
      db
        .select({ value: countDistinct(workouts.userId) })
        .from(workouts)
        .where(gte(workouts.completedAt, since)),
      db.select({ value: count() }).from(pushSubscriptions),
      db
        .select({ value: count() })
        .from(goals)
        .where(and(isNull(goals.achievedAt), isNull(goals.archivedAt))),
      db.select({ value: count() }).from(programs).where(eq(programs.status, 'proposed')),
      db
        .select({ day: completedDay, value: count() })
        .from(workouts)
        .where(gte(workouts.completedAt, seriesSince))
        .groupBy(completedDay),
      db
        .select({ day: completedDay, value: countDistinct(workouts.userId) })
        .from(workouts)
        .where(gte(workouts.completedAt, seriesSince))
        .groupBy(completedDay),
      db
        .select({
          actor: programEvents.actor,
          summary: programEvents.summary,
          occurredAt: programEvents.occurredAt,
        })
        .from(programEvents)
        .orderBy(desc(programEvents.occurredAt), desc(programEvents.id))
        .limit(RECENT_EVENTS_LIMIT),
      db
        .select({
          name: workouts.name,
          startedAt: workouts.startedAt,
          volumeKg: sql<number>`coalesce(sum(${sets.reps} * ${sets.weight}), 0)`.mapWith(Number),
        })
        .from(workouts)
        .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
        .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
        .where(isNotNull(workouts.completedAt))
        .groupBy(workouts.id)
        .orderBy(desc(workouts.completedAt))
        .limit(RECENT_WORKOUTS_LIMIT),
    ])

    return {
      ok: true,
      data: {
        workoutsCompleted7d: completedRows[0]?.value ?? 0,
        activeUsers7d: usersRows[0]?.value ?? 0,
        pushSubscriptions: pushRows[0]?.value ?? 0,
        activeGoals: goalsRows[0]?.value ?? 0,
        pendingProposals: proposalsRows[0]?.value ?? 0,
        workoutsPerDay: fillDailySeries(workoutsPerDayRows, SERIES_WINDOW_DAYS),
        activeUsersPerDay: fillDailySeries(activeUsersPerDayRows, SERIES_WINDOW_DAYS),
        recentEvents,
        recentWorkouts,
      },
    }
  } catch (error: unknown) {
    console.error('[ops] app-vitals query failed', error)
    return { ok: false, reason: 'unavailable' }
  }
}
