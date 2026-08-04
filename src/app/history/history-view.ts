import type { WorkoutSummary } from '@/db/workouts'

/**
 * Pure view logic for /history — month bucketing, the editorial status line,
 * and the row-emphasis bar math. Operates on the summaries array the page
 * already fetches (zero new queries); dates group in the SERVER's frame, the
 * same frame the row's calendar anchors already render in.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000
const STATUS_WINDOW_DAYS = 30

/** One calendar month of completed sessions, list order preserved. */
export interface MonthBucket {
  /** Stable key, e.g. "2026-07". */
  key: string
  /** Header label — month name, year appended only when it isn't `now`'s
   *  ("August" vs "August 2025"): the current year is the reader's default. */
  label: string
  sessions: number
  volumeKg: number
  workouts: WorkoutSummary[]
}

/** en-US matches formatWorkoutDate — one locale for all date display. */
const monthLongFormat = new Intl.DateTimeFormat('en-US', { month: 'long' })

function bucketKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Groups an already-sorted (newest-first) summaries array into month buckets,
 * preserving order. Builds fresh structures; never mutates input.
 */
export function monthBuckets(workouts: readonly WorkoutSummary[], now: Date): MonthBucket[] {
  const buckets: MonthBucket[] = []
  for (const workout of workouts) {
    const key = bucketKey(workout.startedAt)
    const last = buckets[buckets.length - 1]
    if (last !== undefined && last.key === key) {
      last.sessions += 1
      last.volumeKg += workout.volumeKg
      last.workouts.push(workout)
      continue
    }
    const year = workout.startedAt.getFullYear()
    buckets.push({
      key,
      label:
        year === now.getFullYear()
          ? monthLongFormat.format(workout.startedAt)
          : `${monthLongFormat.format(workout.startedAt)} ${year}`,
      sessions: 1,
      volumeKg: workout.volumeKg,
      workouts: [workout],
    })
  }
  return buckets
}

/**
 * The page's editorial status line, computed honestly from the list itself:
 *   "9 sessions in the last 30 days."
 *   "9 sessions in the last 30 days — your most consistent month yet."
 * The suffix only when THIS calendar month's count strictly beats every other
 * month on record (a partial month already ahead has earned it; a tie hasn't).
 * Null when the trailing 30 days are empty — silence over a zero brag.
 */
export function historyStatusLine(
  workouts: readonly WorkoutSummary[],
  now: Date,
): string | null {
  const windowStart = now.getTime() - STATUS_WINDOW_DAYS * MS_PER_DAY
  const recent = workouts.filter((w) => w.startedAt.getTime() >= windowStart).length
  if (recent === 0) return null
  const base = `${recent} ${recent === 1 ? 'session' : 'sessions'} in the last ${STATUS_WINDOW_DAYS} days`

  const currentKey = bucketKey(now)
  const countsByMonth = new Map<string, number>()
  for (const w of workouts) {
    const key = bucketKey(w.startedAt)
    countsByMonth.set(key, (countsByMonth.get(key) ?? 0) + 1)
  }
  const currentCount = countsByMonth.get(currentKey) ?? 0
  let bestOther = 0
  for (const [key, count] of countsByMonth) {
    if (key !== currentKey && count > bestOther) bestOther = count
  }
  const isRecordMonth = bestOther > 0 && currentCount > bestOther
  return isRecordMonth ? `${base} — your most consistent month yet.` : `${base}.`
}

/**
 * A row's emphasis-bar width as a whole percent of the list's max volume.
 * Zero max (all-bodyweight log) yields 0, never NaN/Infinity.
 */
export function rowEmphasisPct(volumeKg: number, maxVolumeKg: number): number {
  if (maxVolumeKg <= 0) return 0
  return Math.round((volumeKg / maxVolumeKg) * 100)
}
