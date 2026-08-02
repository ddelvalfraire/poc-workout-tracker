/**
 * Relative-time and duration formatting for the ops board. Extracted from the
 * v1 page-local helper so every panel (server components under
 * src/components/ops/) shares one implementation and it's unit-testable —
 * dense tables lean on "3h ago" everywhere, so drift between panels would be
 * visible immediately.
 *
 * Pure: `now` is injectable for tests; callers omit it in production.
 */

const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

/** Compact "3h ago" / "2d ago" from a Date or ISO string; '' when unusable. */
export function timeAgo(value: Date | string | null, now: number = Date.now()): string {
  if (!value) return ''
  const then = value instanceof Date ? value.getTime() : Date.parse(value)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < SECONDS_PER_MINUTE) return `${seconds}s ago`
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE)
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m ago`
  const hours = Math.round(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return `${hours}h ago`
  return `${Math.round(hours / HOURS_PER_DAY)}d ago`
}

const DAY_LABEL_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

/** Chart tick label for a UTC "YYYY-MM-DD" day key: "Jul 19"; '' when unusable. */
export function shortDayLabel(day: string): string {
  const parsed = Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(parsed)) return ''
  return DAY_LABEL_FMT.format(parsed)
}

/** Compact build/latency duration: "42s", "3m 12s"; '' for null/negative. */
export function formatDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return ''
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  return `${minutes}m ${totalSeconds % SECONDS_PER_MINUTE}s`
}
