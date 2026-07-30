/** Weekday display names, indexed 0–6 Sunday-first (Date#getDay order). */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/**
 * The hero eyebrow's time anchor for a scheduled day: 'Today', 'Tomorrow', the
 * weekday name of the NEAREST scheduled weekday (multiple weekdays pick the
 * soonest, wrapping past Saturday), or null when the day is unscheduled — the
 * caller renders the pre-schedule "Up next" for null.
 *
 * `today` must be the USER'S local now: Date#getDay() reads the runtime's
 * local timezone, and the server's calendar day is not the user's (Vercel
 * renders in UTC), so every consumer computes this client-side after mount —
 * the same rule as `isSameLocalDay` (lib/local-day.ts).
 */
export function scheduleAnchor(weekdays: readonly number[], today: Date): string | null {
  // Tolerate junk defensively (external data may reach here pre-validation).
  const valid = weekdays.filter((w) => Number.isInteger(w) && w >= 0 && w <= 6)
  if (valid.length === 0) return null
  const dow = today.getDay()
  // Days until each scheduled weekday, 0..6; the minimum is the anchor.
  const delta = Math.min(...valid.map((w) => (w - dow + 7) % 7))
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  return WEEKDAY_NAMES[(dow + delta) % 7]
}
