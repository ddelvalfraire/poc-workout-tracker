import { cache } from 'react'
import { getCheckInFacts } from '@/db/check-ins'

/**
 * The program-suggested body check-in due rule ("this program suggests a
 * check-in every N days"). Pure core here, one thin composition over the db
 * facts read (db/check-ins.ts) — the cron rider and the home card both ask
 * this module, so push and card can never disagree on "due".
 *
 * There is deliberately NO stored last-check-in timestamp: the last check-in
 * is a derived fact — max(latest bodyweight log, latest measurement, latest
 * photo). Logging ANY of the three counts, so a user who only weighs in is
 * never nagged for skipping the tape.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** The freshest of the per-source timestamps; null when the user has none. */
export function latestCheckInAt(dates: ReadonlyArray<Date | null>): Date | null {
  let latest: Date | null = null
  for (const date of dates) {
    if (date !== null && (latest === null || date.getTime() > latest.getTime())) {
      latest = date
    }
  }
  return latest
}

/**
 * Due when the user has never checked in, or the cadence has fully elapsed
 * (last + cadenceDays <= now — exactly-at-cadence IS due).
 */
export function isCheckInDue(lastCheckInAt: Date | null, cadenceDays: number, now: Date): boolean {
  if (lastCheckInAt === null) return true
  return lastCheckInAt.getTime() + cadenceDays * MS_PER_DAY <= now.getTime()
}

/** Whole days elapsed since the last check-in (floored; never negative). */
export function daysSinceCheckIn(lastCheckInAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - lastCheckInAt.getTime()) / MS_PER_DAY))
}

/** What the cron rider and the home card need to render a check-in nudge. */
export interface CheckInStatus {
  due: boolean
  programName: string
  cadenceDays: number
  lastCheckInAt: Date | null
  /** Whole days since the last check-in; null when there has never been one. */
  daysSinceLast: number | null
}

/**
 * The user's check-in status, or null when no active program suggests a
 * cadence (the feature is entirely silent then — no card, no push). Thin: one
 * facts read + the pure rules above.
 *
 * Request-memoized (React cache — per-request only, never cross-request).
 * CONSTRAINT: `nowMs` is epoch ms, NOT a Date — cache keys args by Object.is,
 * and a fresh Date object per call would defeat memoization. Callers sharing
 * one request should omit it (key = userId alone; "now" resolves once, on
 * cache miss) or pass the same primitive.
 */
export const getCheckInStatus = cache(async (
  userId: string,
  nowMs?: number,
): Promise<CheckInStatus | null> => {
  const now = nowMs === undefined ? new Date() : new Date(nowMs)
  const facts = await getCheckInFacts(userId)
  if (!facts) return null
  const last = latestCheckInAt([
    facts.latestBodyweightAt,
    facts.latestMeasurementAt,
    facts.latestPhotoAt,
  ])
  return {
    due: isCheckInDue(last, facts.cadenceDays, now),
    programName: facts.programName,
    cadenceDays: facts.cadenceDays,
    lastCheckInAt: last,
    daysSinceLast: last === null ? null : daysSinceCheckIn(last, now),
  }
})
