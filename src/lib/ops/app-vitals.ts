/**
 * First-party app vitals for the ops board — the one card that reads OUR
 * Postgres rather than a vendor API. Unlike the rest of the db layer these
 * are cross-user admin aggregates (no userId scope): the operator is looking
 * at the whole system, not one account.
 *
 * Every query is a cheap indexed count or a tiny newest-first slice; nothing
 * scans. The DB is core infrastructure, so there is no 'unconfigured' state —
 * a failure is 'unavailable' (fails soft like every other ops source, never
 * throwing into the page).
 *
 * Server-only: never import from a Client Component.
 */
import { and, count, countDistinct, desc, eq, gte, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { goals, programEvents, programs, pushSubscriptions, workouts } from '@/db/schema'
import type { OpsResult } from './types'

/** How far back "active" and "completed" windows reach. */
const ACTIVE_WINDOW_DAYS = 7
const RECENT_EVENTS_LIMIT = 5

/** One change-log line, cross-user (the ops view isn't scoped to an owner). */
export interface RecentEvent {
  actor: string
  summary: string
  occurredAt: Date
}

export interface AppVitals {
  workoutsCompleted7d: number
  activeUsers7d: number
  pushSubscriptions: number
  activeGoals: number
  pendingProposals: number
  recentEvents: RecentEvent[]
}

function windowStart(): Date {
  return new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
}

export async function getAppVitals(): Promise<OpsResult<AppVitals>> {
  try {
    const since = windowStart()

    const [completedRows, usersRows, pushRows, goalsRows, proposalsRows, recentEvents] =
      await Promise.all([
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
          .select({
            actor: programEvents.actor,
            summary: programEvents.summary,
            occurredAt: programEvents.occurredAt,
          })
          .from(programEvents)
          .orderBy(desc(programEvents.occurredAt), desc(programEvents.id))
          .limit(RECENT_EVENTS_LIMIT),
      ])

    return {
      ok: true,
      data: {
        workoutsCompleted7d: completedRows[0]?.value ?? 0,
        activeUsers7d: usersRows[0]?.value ?? 0,
        pushSubscriptions: pushRows[0]?.value ?? 0,
        activeGoals: goalsRows[0]?.value ?? 0,
        pendingProposals: proposalsRows[0]?.value ?? 0,
        recentEvents,
      },
    }
  } catch (error: unknown) {
    console.error('[ops] app-vitals query failed', error)
    return { ok: false, reason: 'unavailable' }
  }
}
