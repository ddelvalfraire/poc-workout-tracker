import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { MUSCLE_GROUPS, type MuscleGroup } from '@/lib/muscle-groups'

/**
 * The /exercises library's alive-row language — zoning, status lines,
 * recency words, and the URL-facet codec. Pure functions only (the drawer-
 * status.ts discipline) so the voice unit-tests without React or the DB;
 * the server page feeds them `listLoggedExercises` entries and renders the
 * returned strings, keeping the client island display-string-only.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Trained within this many days = still TRAINING; beyond = DORMANT. */
const DORMANT_AFTER_DAYS = 28
/** A running-max advance inside this window reads as a recent PR (MOVING). */
const MOVING_PR_WINDOW_DAYS = 30

/** Row zones, in display order: rows carry live status, not bookkeeping. */
export type ExerciseZone = 'moving' | 'training' | 'dormant'

export const ZONE_ORDER: readonly ExerciseZone[] = ['moving', 'training', 'dormant']

/** Zone header copy — rendered font-display uppercase by the page. */
export const ZONE_LABELS: Record<ExerciseZone, string> = {
  moving: 'Moving',
  training: 'Training',
  dormant: 'Dormant',
}

/**
 * The zoning rule: DORMANT past the 4-week silence line no matter what
 * (an old PR is history, not momentum); otherwise MOVING when the running-
 * max e1RM advanced inside the last 30 days or the 30d-vs-prior delta is
 * positive; TRAINING is the active-but-flat remainder.
 */
export function exerciseZone(
  entry: { lastPerformedAt: Date; lastPrAt: Date | null; trendDeltaKg: number | null },
  now: Date,
): ExerciseZone {
  const sinceTrainedDays = (now.getTime() - entry.lastPerformedAt.getTime()) / DAY_MS
  if (sinceTrainedDays > DORMANT_AFTER_DAYS) return 'dormant'
  const recentPr =
    entry.lastPrAt !== null &&
    (now.getTime() - entry.lastPrAt.getTime()) / DAY_MS <= MOVING_PR_WINDOW_DAYS
  if (recentPr || (entry.trendDeltaKg !== null && entry.trendDeltaKg > 0)) return 'moving'
  return 'training'
}

/** "142 kg e1RM" (display unit); null when no scorable history —
 *  the row degrades to its session-count line (the drawer contract). */
export function e1rmStatusBase(bestE1rmKg: number | null, unit: WeightUnit): string | null {
  if (bestE1rmKg === null) return null
  return `${Math.round(kgToDisplay(bestE1rmKg, unit))} ${unit} e1RM`
}

/** The row's trend chip: "↑ +5 this month" / "↓ −5 this month", or null when
 *  there is no provable delta or it rounds to zero in the display unit (a
 *  "+0" would be noise wearing an arrow). Direction lets the page volt-accent
 *  ONLY the up case — volt = achievement, never decline. */
export function e1rmDeltaChip(
  trendDeltaKg: number | null,
  unit: WeightUnit,
): { text: string; direction: 'up' | 'down' } | null {
  if (trendDeltaKg === null) return null
  const magnitude = Math.round(Math.abs(kgToDisplay(trendDeltaKg, unit)))
  if (magnitude === 0) return null
  return trendDeltaKg > 0
    ? { text: `↑ +${magnitude} this month`, direction: 'up' }
    : { text: `↓ −${magnitude} this month`, direction: 'down' }
}

/** Fallback status when nothing is e1RM-scorable: "8 sessions". */
export function sessionCountLine(sessionCount: number): string {
  return `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}`
}

// en-US matches formatWorkoutDate — one locale for all date display.
const recentDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

/** Past the fresh-date window, recency switches to relative words. */
const RECENT_DATE_DAYS = 28
/** Weeks read naturally up to ~3 months; beyond that, months. */
const MAX_WEEKS_AGO_DAYS = 84
const AVG_DAYS_PER_MONTH = 30.44

/**
 * Row recency: dates while fresh ("Today" / "Yesterday" / "Jul 12"), relative
 * words past the threshold ("5 wks ago", "4 mo ago") — a precise date on a
 * months-old row is bookkeeping; "5 wks ago" is status.
 */
export function recencyLabel(lastPerformedAt: Date, now: Date): string {
  const days = Math.floor((now.getTime() - lastPerformedAt.getTime()) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days <= RECENT_DATE_DAYS) return recentDateFormat.format(lastPerformedAt)
  if (days <= MAX_WEEKS_AGO_DAYS) {
    const weeks = Math.round(days / 7)
    return `${weeks} ${weeks === 1 ? 'wk' : 'wks'} ago`
  }
  const months = Math.max(2, Math.round(days / AVG_DAYS_PER_MONTH))
  return `${months} mo ago`
}

/** The two list orders the sort toggle offers. */
export type LibrarySort = 'recent' | 'trained'

export interface LibraryParams {
  muscle: MuscleGroup | null
  sort: LibrarySort
}

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v

/**
 * URL-as-state codec, read side: unknown values degrade to the defaults
 * (no facet, recent sort) — a guessed query string never errors a list page.
 */
export function parseLibraryParams(searchParams: {
  muscle?: string | string[]
  sort?: string | string[]
}): LibraryParams {
  const muscleRaw = first(searchParams.muscle)
  const muscle = (MUSCLE_GROUPS as readonly string[]).includes(muscleRaw ?? '')
    ? (muscleRaw as MuscleGroup)
    : null
  const sort: LibrarySort = first(searchParams.sort) === 'trained' ? 'trained' : 'recent'
  return { muscle, sort }
}

/** URL-as-state codec, write side: defaults are omitted so the canonical
 *  no-facet URL stays the clean `/exercises`. */
export function libraryHref(params: LibraryParams): string {
  const query = new URLSearchParams()
  if (params.muscle !== null) query.set('muscle', params.muscle)
  if (params.sort !== 'recent') query.set('sort', params.sort)
  const qs = query.toString()
  return qs === '' ? '/exercises' : `/exercises?${qs}`
}

/** What the comparator needs — zone precomputed by the caller. */
export interface ZonedEntry {
  zone: ExerciseZone
  sessionCount: number
  lastPerformedAtMs: number
}

/**
 * List order: zones first (moving → training → dormant — the page renders
 * headers on zone change), then the toggle's order within a zone. "Most
 * trained" ties break on recency so equal counts stay stable and honest.
 */
export function compareLibraryEntries(a: ZonedEntry, b: ZonedEntry, sort: LibrarySort): number {
  const zoneDelta = ZONE_ORDER.indexOf(a.zone) - ZONE_ORDER.indexOf(b.zone)
  if (zoneDelta !== 0) return zoneDelta
  if (sort === 'trained' && b.sessionCount !== a.sessionCount) {
    return b.sessionCount - a.sessionCount
  }
  return b.lastPerformedAtMs - a.lastPerformedAtMs
}
