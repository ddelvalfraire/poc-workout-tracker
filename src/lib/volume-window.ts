/**
 * The two week windows the volume page compares. Rolling mode is
 * timezone-free (7×24h blocks ending now). Calendar mode is Monday-start
 * weeks in the CLIENT's local time — the server can't know the client's day
 * (lib/local-day.ts's rule), so callers pass the client's
 * `new Date().getTimezoneOffset()` through URL state. Pure minute arithmetic:
 * a DST shift inside the week moves the boundary by the changed hour —
 * accepted drift for a training log, documented here rather than hidden.
 */

export type VolumeWindowMode = 'rolling' | 'calendar'

export interface VolumeWindow {
  /** Inclusive. */
  start: Date
  /** Exclusive. */
  end: Date
}

export interface VolumeWindows {
  current: VolumeWindow
  previous: VolumeWindow
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Current + previous comparison windows. `tzOffsetMinutes` follows JS
 * `Date.prototype.getTimezoneOffset` semantics (UTC = local + offset) and is
 * only read in calendar mode.
 */
export function volumeWindows(
  mode: VolumeWindowMode,
  now: Date,
  tzOffsetMinutes = 0,
): VolumeWindows {
  if (mode === 'rolling') {
    const end = now
    const start = new Date(now.getTime() - WEEK_MS)
    return {
      current: { start, end },
      previous: { start: new Date(start.getTime() - WEEK_MS), end: start },
    }
  }

  // Calendar: shift into the client's local frame, find Monday 00:00 there,
  // shift the boundary back to a real UTC instant.
  const offsetMs = tzOffsetMinutes * MINUTE_MS
  const localFrame = new Date(now.getTime() - offsetMs)
  const daysSinceMonday = (localFrame.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  const localMidnight = Date.UTC(
    localFrame.getUTCFullYear(),
    localFrame.getUTCMonth(),
    localFrame.getUTCDate(),
  )
  const weekStart = new Date(localMidnight - daysSinceMonday * DAY_MS + offsetMs)
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS)
  return {
    current: { start: weekStart, end: weekEnd },
    previous: { start: new Date(weekStart.getTime() - WEEK_MS), end: weekStart },
  }
}

/** Whether an instant falls inside a window: start inclusive, end exclusive. */
export function inWindow(at: Date, window: VolumeWindow): boolean {
  const t = at.getTime()
  return t >= window.start.getTime() && t < window.end.getTime()
}
