/**
 * First-party product analytics for /ops/product — the successor to
 * app-vitals.ts, widened from "one panel" to a full tab. Cross-user admin
 * aggregates (no userId scope), same rules as the rest of the ops layer:
 *
 * - Every query is a filtered count over one small table, a day-bucketed
 *   aggregate over a bounded window, or a newest-first LIMIT feed. Nothing
 *   scans unbounded rows into memory.
 * - The DB is core infrastructure — no 'unconfigured' state; failures are
 *   'unavailable' and fail soft (OpsResult, never throwing into the page).
 * - Activity log strategy: six small newest-first reads (one per source
 *   table, each LIMIT 50) merged in memory via mergeActivity, instead of one
 *   UNION. The UNION would save round-trips but flattens every source to a
 *   common column shape in SQL and loses Drizzle's typing; six LIMIT-50
 *   reads are cheap and each stays a typed query.
 * - Skipped adoption metrics: coach chats (threads live in Redis with no
 *   indexed count — counting means a key SCAN) and a per-kind goals breakdown
 *   (kept as one "Goals created" row so the table stays a fixed shape).
 * - Proposal counts come from program_events (action = 'upsert_program' by
 *   the coach actor / 'adopt_program'); declining hard-deletes the program
 *   and cascades its events away, so declined proposals undercount —
 *   accepted, same caveat declineProgram documents.
 *
 * Server-only: never import from a Client Component (activity.ts holds the
 * shared pure types/helpers instead).
 */
import { count, countDistinct, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  bodyMeasurements,
  bodyweightLogs,
  goals,
  programEvents,
  programs,
  progressPhotos,
  pushSubscriptions,
  sets,
  workoutExercises,
  workouts,
  workoutTemplates,
} from '@/db/schema'
import { fillDailySeries, type DayPoint } from './series'
import { mergeActivity, ACTIVITY_LIMIT, type ActivityItem } from './activity'
import type { OpsResult } from './types'

/** Headline "active" window (WAU). */
const KPI_WINDOW_DAYS = 7
/** The tab's chart + adoption long window. */
const SERIES_WINDOW_DAYS = 30

export interface ProductKpis {
  activeUsers7d: number
  workouts7d: number
  workouts30d: number
  /** workouts7d / activeUsers7d, one decimal; 0 when nobody was active. */
  avgWorkoutsPerActiveUser7d: number
  pushSubscriptions: number
  activeGoals: number
  achievedGoals: number
  photosTotal: number
  measurementsTotal: number
  programsActive: number
  programsProposed: number
}

/** One feature row in the adoption table. */
export interface AdoptionRow {
  feature: string
  count7d: number
  count30d: number
  countAll: number
}

export interface ProductAnalytics {
  kpis: ProductKpis
  /** Dense ascending 30-day series (zero-filled): completed workouts per day. */
  workoutsPerDay: DayPoint[]
  /** Dense ascending 30-day series (zero-filled): distinct active users per day. */
  activeUsersPerDay: DayPoint[]
  /** Dense ascending 30-day series (zero-filled): goals achieved per day. */
  goalsAchievedPerDay: DayPoint[]
  adoption: AdoptionRow[]
  /** Merged newest-first cross-source log, capped at ACTIVITY_LIMIT. */
  activity: ActivityItem[]
}

const numberFmt = new Intl.NumberFormat('en-US')

function windowStart(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

/**
 * `count(*) filter (where col >= since)` — one scan serves many windows.
 * The cutoff MUST cross the wire as an ISO string: a raw sql`` fragment gets
 * no column encoder (drizzle's noop encoder passes the value through), and
 * postgres.js cannot bind a JS Date (ERR_INVALID_ARG_TYPE in Bind). Same
 * rule as workouts.ts's `explicit.toISOString()`; typed operators like
 * gte(col, date) keep Dates because the column encoder serializes them.
 */
function countSince(column: unknown, since: Date) {
  return sql<number>`count(*) filter (where ${column} >= ${since.toISOString()})`.mapWith(Number)
}

export async function getProductAnalytics(): Promise<OpsResult<ProductAnalytics>> {
  try {
    const since7 = windowStart(KPI_WINDOW_DAYS)
    const since30 = windowStart(SERIES_WINDOW_DAYS)
    // Raw-fragment cutoffs: ISO strings only (see countSince). since7/since30
    // Dates remain for typed gte() comparisons.
    const since7Iso = since7.toISOString()
    const since30Iso = since30.toISOString()
    // UTC calendar-day buckets — must match fillDailySeries' "YYYY-MM-DD" keys.
    const completedDay = sql<string>`to_char(${workouts.completedAt} at time zone 'utc', 'YYYY-MM-DD')`
    const achievedDay = sql<string>`to_char(${goals.achievedAt} at time zone 'utc', 'YYYY-MM-DD')`

    const [
      workoutTotals,
      pushRows,
      goalTotals,
      programTotals,
      photoTotals,
      measurementTotals,
      bodyweightTotals,
      templateTotals,
      proposalTotals,
      workoutsPerDayRows,
      activeUsersPerDayRows,
      goalsAchievedPerDayRows,
      programEventFeed,
      workoutFeed,
      goalFeed,
      photoFeed,
      measurementFeed,
      bodyweightFeed,
    ] = await Promise.all([
      db
        .select({
          workouts7d: countSince(workouts.completedAt, since7),
          workouts30d: countSince(workouts.completedAt, since30),
          activeUsers7d: sql<number>`count(distinct ${workouts.userId}) filter (where ${workouts.completedAt} >= ${since7Iso})`.mapWith(
            Number,
          ),
        })
        .from(workouts)
        .where(isNotNull(workouts.completedAt)),
      db.select({ value: count() }).from(pushSubscriptions),
      db
        .select({
          active: sql<number>`count(*) filter (where ${goals.achievedAt} is null and ${goals.archivedAt} is null)`.mapWith(
            Number,
          ),
          achieved: sql<number>`count(*) filter (where ${goals.achievedAt} is not null)`.mapWith(
            Number,
          ),
          created7d: countSince(goals.createdAt, since7),
          created30d: countSince(goals.createdAt, since30),
          createdAll: count(),
        })
        .from(goals),
      db
        .select({
          active: sql<number>`count(*) filter (where ${programs.status} = 'active')`.mapWith(
            Number,
          ),
          proposed: sql<number>`count(*) filter (where ${programs.status} = 'proposed')`.mapWith(
            Number,
          ),
          wger7d: sql<number>`count(*) filter (where ${programs.authorActor} = 'wger' and ${programs.createdAt} >= ${since7Iso})`.mapWith(
            Number,
          ),
          wger30d: sql<number>`count(*) filter (where ${programs.authorActor} = 'wger' and ${programs.createdAt} >= ${since30Iso})`.mapWith(
            Number,
          ),
          wgerAll: sql<number>`count(*) filter (where ${programs.authorActor} = 'wger')`.mapWith(
            Number,
          ),
        })
        .from(programs),
      db
        .select({
          c7: countSince(progressPhotos.takenAt, since7),
          c30: countSince(progressPhotos.takenAt, since30),
          all: count(),
        })
        .from(progressPhotos),
      db
        .select({
          c7: countSince(bodyMeasurements.measuredAt, since7),
          c30: countSince(bodyMeasurements.measuredAt, since30),
          all: count(),
        })
        .from(bodyMeasurements),
      db
        .select({
          c7: countSince(bodyweightLogs.weighedAt, since7),
          c30: countSince(bodyweightLogs.weighedAt, since30),
          all: count(),
        })
        .from(bodyweightLogs),
      db
        .select({
          c7: countSince(workoutTemplates.createdAt, since7),
          c30: countSince(workoutTemplates.createdAt, since30),
          all: count(),
        })
        .from(workoutTemplates),
      db
        .select({
          proposed7d: sql<number>`count(*) filter (where ${programEvents.action} = 'upsert_program' and ${programEvents.actor} = 'coach' and ${programEvents.occurredAt} >= ${since7Iso})`.mapWith(
            Number,
          ),
          proposed30d: sql<number>`count(*) filter (where ${programEvents.action} = 'upsert_program' and ${programEvents.actor} = 'coach' and ${programEvents.occurredAt} >= ${since30Iso})`.mapWith(
            Number,
          ),
          proposedAll: sql<number>`count(*) filter (where ${programEvents.action} = 'upsert_program' and ${programEvents.actor} = 'coach')`.mapWith(
            Number,
          ),
          adopted7d: sql<number>`count(*) filter (where ${programEvents.action} = 'adopt_program' and ${programEvents.occurredAt} >= ${since7Iso})`.mapWith(
            Number,
          ),
          adopted30d: sql<number>`count(*) filter (where ${programEvents.action} = 'adopt_program' and ${programEvents.occurredAt} >= ${since30Iso})`.mapWith(
            Number,
          ),
          adoptedAll: sql<number>`count(*) filter (where ${programEvents.action} = 'adopt_program')`.mapWith(
            Number,
          ),
        })
        .from(programEvents),
      db
        .select({ day: completedDay, value: count() })
        .from(workouts)
        .where(gte(workouts.completedAt, since30))
        .groupBy(completedDay),
      db
        .select({ day: completedDay, value: countDistinct(workouts.userId) })
        .from(workouts)
        .where(gte(workouts.completedAt, since30))
        .groupBy(completedDay),
      db
        .select({ day: achievedDay, value: count() })
        .from(goals)
        .where(gte(goals.achievedAt, since30))
        .groupBy(achievedDay),
      db
        .select({
          actor: programEvents.actor,
          summary: programEvents.summary,
          occurredAt: programEvents.occurredAt,
        })
        .from(programEvents)
        .orderBy(desc(programEvents.occurredAt), desc(programEvents.id))
        .limit(ACTIVITY_LIMIT),
      db
        .select({
          name: workouts.name,
          completedAt: workouts.completedAt,
          volumeKg: sql<number>`coalesce(sum(${sets.reps} * ${sets.weight}), 0)`.mapWith(Number),
        })
        .from(workouts)
        .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
        .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
        .where(isNotNull(workouts.completedAt))
        .groupBy(workouts.id)
        .orderBy(desc(workouts.completedAt))
        .limit(ACTIVITY_LIMIT),
      db
        .select({
          kind: goals.kind,
          exerciseName: goals.exerciseName,
          achievedAt: goals.achievedAt,
        })
        .from(goals)
        .where(isNotNull(goals.achievedAt))
        .orderBy(desc(goals.achievedAt))
        .limit(ACTIVITY_LIMIT),
      db
        .select({ pose: progressPhotos.pose, takenAt: progressPhotos.takenAt })
        .from(progressPhotos)
        .orderBy(desc(progressPhotos.takenAt))
        .limit(ACTIVITY_LIMIT),
      db
        .select({
          site: bodyMeasurements.site,
          valueCm: bodyMeasurements.valueCm,
          measuredAt: bodyMeasurements.measuredAt,
        })
        .from(bodyMeasurements)
        .orderBy(desc(bodyMeasurements.measuredAt))
        .limit(ACTIVITY_LIMIT),
      db
        .select({ weightKg: bodyweightLogs.weightKg, weighedAt: bodyweightLogs.weighedAt })
        .from(bodyweightLogs)
        .orderBy(desc(bodyweightLogs.weighedAt))
        .limit(ACTIVITY_LIMIT),
    ])

    const workoutRow = workoutTotals[0]
    const goalRow = goalTotals[0]
    const programRow = programTotals[0]
    const proposalRow = proposalTotals[0]
    const activeUsers7d = workoutRow?.activeUsers7d ?? 0
    const workouts7d = workoutRow?.workouts7d ?? 0

    const activity = mergeActivity([
      programEventFeed.map(
        (event): ActivityItem => ({
          type: 'program',
          line: `[${event.actor}] ${event.summary}`,
          at: event.occurredAt,
        }),
      ),
      workoutFeed
        // completedAt is non-null by the WHERE; narrow for the type system.
        .filter((workout): workout is typeof workout & { completedAt: Date } =>
          Boolean(workout.completedAt),
        )
        .map(
          (workout): ActivityItem => ({
            type: 'workout',
            line: `Completed ${workout.name ?? 'Workout'} · ${numberFmt.format(Math.round(workout.volumeKg))} kg`,
            at: workout.completedAt,
          }),
        ),
      goalFeed
        .filter((goal): goal is typeof goal & { achievedAt: Date } => Boolean(goal.achievedAt))
        .map(
          (goal): ActivityItem => ({
            type: 'goal',
            line: `Goal achieved: ${goal.exerciseName ?? goal.kind}`,
            at: goal.achievedAt,
          }),
        ),
      photoFeed.map(
        (photo): ActivityItem => ({
          type: 'photo',
          line: photo.pose ? `Progress photo added (${photo.pose})` : 'Progress photo added',
          at: photo.takenAt,
        }),
      ),
      measurementFeed.map(
        (measurement): ActivityItem => ({
          type: 'measurement',
          line: `Measured ${measurement.site}: ${measurement.valueCm} cm`,
          at: measurement.measuredAt,
        }),
      ),
      bodyweightFeed.map(
        (log): ActivityItem => ({
          type: 'bodyweight',
          line: `Bodyweight logged: ${log.weightKg} kg`,
          at: log.weighedAt,
        }),
      ),
    ])

    return {
      ok: true,
      data: {
        kpis: {
          activeUsers7d,
          workouts7d,
          workouts30d: workoutRow?.workouts30d ?? 0,
          avgWorkoutsPerActiveUser7d:
            activeUsers7d > 0 ? Math.round((workouts7d / activeUsers7d) * 10) / 10 : 0,
          pushSubscriptions: pushRows[0]?.value ?? 0,
          activeGoals: goalRow?.active ?? 0,
          achievedGoals: goalRow?.achieved ?? 0,
          photosTotal: photoTotals[0]?.all ?? 0,
          measurementsTotal: measurementTotals[0]?.all ?? 0,
          programsActive: programRow?.active ?? 0,
          programsProposed: programRow?.proposed ?? 0,
        },
        workoutsPerDay: fillDailySeries(workoutsPerDayRows, SERIES_WINDOW_DAYS),
        activeUsersPerDay: fillDailySeries(activeUsersPerDayRows, SERIES_WINDOW_DAYS),
        goalsAchievedPerDay: fillDailySeries(goalsAchievedPerDayRows, SERIES_WINDOW_DAYS),
        adoption: [
          {
            feature: 'Templates saved',
            count7d: templateTotals[0]?.c7 ?? 0,
            count30d: templateTotals[0]?.c30 ?? 0,
            countAll: templateTotals[0]?.all ?? 0,
          },
          {
            feature: 'wger imports',
            count7d: programRow?.wger7d ?? 0,
            count30d: programRow?.wger30d ?? 0,
            countAll: programRow?.wgerAll ?? 0,
          },
          {
            feature: 'Coach proposals',
            count7d: proposalRow?.proposed7d ?? 0,
            count30d: proposalRow?.proposed30d ?? 0,
            countAll: proposalRow?.proposedAll ?? 0,
          },
          {
            feature: 'Proposals adopted',
            count7d: proposalRow?.adopted7d ?? 0,
            count30d: proposalRow?.adopted30d ?? 0,
            countAll: proposalRow?.adoptedAll ?? 0,
          },
          {
            feature: 'Goals created',
            count7d: goalRow?.created7d ?? 0,
            count30d: goalRow?.created30d ?? 0,
            countAll: goalRow?.createdAll ?? 0,
          },
          {
            feature: 'Progress photos',
            count7d: photoTotals[0]?.c7 ?? 0,
            count30d: photoTotals[0]?.c30 ?? 0,
            countAll: photoTotals[0]?.all ?? 0,
          },
          {
            feature: 'Measurements',
            count7d: measurementTotals[0]?.c7 ?? 0,
            count30d: measurementTotals[0]?.c30 ?? 0,
            countAll: measurementTotals[0]?.all ?? 0,
          },
          {
            feature: 'Bodyweight logs',
            count7d: bodyweightTotals[0]?.c7 ?? 0,
            count30d: bodyweightTotals[0]?.c30 ?? 0,
            countAll: bodyweightTotals[0]?.all ?? 0,
          },
        ],
        activity,
      },
    }
  } catch (error: unknown) {
    console.error('[ops] product-analytics query failed', error)
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * The one product number the /ops board still needs after the split: the
 * status strip's "Users 7d" pill. A single indexed count so the ops tab does
 * not pay for the whole analytics battery.
 */
export async function getActiveUsers7d(): Promise<OpsResult<number>> {
  try {
    const since = windowStart(KPI_WINDOW_DAYS)
    const rows = await db
      .select({ value: countDistinct(workouts.userId) })
      .from(workouts)
      .where(gte(workouts.completedAt, since))
    return { ok: true, data: rows[0]?.value ?? 0 }
  } catch (error: unknown) {
    console.error('[ops] active-users query failed', error)
    return { ok: false, reason: 'unavailable' }
  }
}
