import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { formatWorkoutDate } from '@/lib/format'
import { sessionBestSet, type SessionBestSet, type SessionSetLike } from '@/lib/session-best-set'
import type { LoggingType } from '@/lib/workout-input'
import type { TrendPoint } from '@/components/charts/trend-chart'

/**
 * Pure derivations for the exercise detail page — window deltas, PR-session
 * marking, time-true chart points, record standing time, and the collapsed
 * history summary. All inputs arrive canonical kg; only the chart-point
 * builder converts (it feeds a display surface directly).
 */

/** The minimal trend-point shape the helpers read (matches ExerciseTrendPoint). */
export interface TrendLike {
  workoutId: string
  performedAt: Date
  e1rm: number
}

/** The comparison window: best of the last 3 sessions vs best of everything
 *  before them. Below RECENT + MIN_PRIOR total sessions the split would
 *  compare against ≤1 session of "history" — noise — so short histories fall
 *  back to the vs-first-session story instead. */
const RECENT_SESSIONS = 3
const MIN_PRIOR_SESSIONS = 2
/** "This month" phrasing cutoff for the recent window's oldest session. */
const MONTH_MS = 31 * 24 * 60 * 60 * 1000

export interface RecentDelta {
  /** Positive gain in kg — flat/negative windows return null instead. */
  gainKg: number
  /** 'recent' = last-3 vs prior window; 'first' = short-history fallback. */
  basis: 'recent' | 'first'
  /** True when the whole recent window sits inside the last month — lets the
   *  caption say "this month" instead of the vaguer "vs earlier sessions". */
  withinMonth: boolean
}

/**
 * The headline delta: best-of-last-3-sessions vs best-of-the-prior-window,
 * falling back to best-vs-first for short histories. Returns null when there
 * is no positive story to tell (single session, flat, or regressed) — the
 * page shows silence over a scary number, same policy as the old vs-first
 * delta it replaces.
 */
export function recentE1rmDelta(
  trend: readonly TrendLike[],
  now: Date = new Date(),
): RecentDelta | null {
  if (trend.length < 2) return null
  if (trend.length < RECENT_SESSIONS + MIN_PRIOR_SESSIONS) {
    const best = Math.max(...trend.map((p) => p.e1rm))
    const gainKg = best - trend[0].e1rm
    return gainKg > 0 ? { gainKg, basis: 'first', withinMonth: false } : null
  }
  const recent = trend.slice(-RECENT_SESSIONS)
  const prior = trend.slice(0, -RECENT_SESSIONS)
  const gainKg = Math.max(...recent.map((p) => p.e1rm)) - Math.max(...prior.map((p) => p.e1rm))
  if (gainKg <= 0) return null
  const withinMonth = now.getTime() - recent[0].performedAt.getTime() <= MONTH_MS
  return { gainKg, basis: 'recent', withinMonth }
}

/**
 * The record-setting sessions: workouts where the running-max e1RM advanced
 * (strictly greater, matching `bestScoredSet`'s tie policy — a tie is a
 * repeat, not a record). The first scorable session trivially set the first
 * record and is included. Trend must arrive ascending by session start.
 */
export function prWorkoutIds(trend: readonly TrendLike[]): Set<string> {
  const ids = new Set<string>()
  let runningMax = -Infinity
  for (const point of trend) {
    if (point.e1rm > runningMax) {
      runningMax = point.e1rm
      ids.add(point.workoutId)
    }
  }
  return ids
}

/**
 * Chart points for the time-true trend: numeric epoch x (layoffs read as
 * gaps, not adjacent ticks), display-unit values, and volt PR dots at the
 * sessions where the running max advanced.
 */
export function buildTrendChartPoints(
  trend: readonly TrendLike[],
  unit: WeightUnit,
  prIds: ReadonlySet<string>,
): TrendPoint[] {
  return trend.map((point) => ({
    t: point.performedAt.getTime(),
    label: formatWorkoutDate(point.performedAt),
    value: kgToDisplay(point.e1rm, unit),
    ...(prIds.has(point.workoutId) ? { pr: true } : {}),
  }))
}

/** Standing-time buckets: under two weeks a record is news, not a reign —
 *  the caption stays quiet. Weeks up to ~2 months, then months, then years. */
const DAY_MS = 24 * 60 * 60 * 1000
const MIN_STANDING_DAYS = 14
const WEEKS_CUTOFF_DAYS = 61
const DAYS_PER_MONTH = 30.44
const MONTHS_PER_YEAR = 12

/**
 * How long a record has stood, as a caption fragment ("held 8 months"), or
 * null when it's too fresh (< 2 weeks) to be a reign worth naming.
 */
export function formatStandingTime(since: Date, now: Date): string | null {
  const days = Math.floor((now.getTime() - since.getTime()) / DAY_MS)
  if (days < MIN_STANDING_DAYS) return null
  if (days < WEEKS_CUTOFF_DAYS) return `held ${Math.floor(days / 7)} weeks`
  const months = Math.floor(days / DAYS_PER_MONTH)
  if (months < 2 * MONTHS_PER_YEAR) return `held ${months} month${months === 1 ? '' : 's'}`
  const years = Math.floor(months / MONTHS_PER_YEAR)
  return `held ${years} year${years === 1 ? '' : 's'}`
}

export interface SessionSummary {
  /** The session's best set (same picker as the logger's stats sheet), or
   *  null when nothing is scorable (all warm-up/uncompleted/duration). */
  best: SessionBestSet | null
  setCount: number
}

/** The collapsed history line's data: best set + how many sets it stands
 *  for. Full detail is one tap away on the workout page. */
export function sessionSummary(
  sets: readonly SessionSetLike[],
  loggingType: LoggingType,
): SessionSummary {
  return { best: sessionBestSet(sets, loggingType), setCount: sets.length }
}
