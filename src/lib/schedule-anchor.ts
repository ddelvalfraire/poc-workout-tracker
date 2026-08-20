/**
 * When a scheduled program day comes round, as a VALUE — never as a display
 * string.
 *
 * This used to return 'Today' / 'Tomorrow' / a weekday name, and callers
 * branched on it (`anchor === 'Today'` decided whether the home hero read
 * "due" or "rest day"). That is business logic riding on English copy: the
 * day the words are localized, the comparison silently stops matching and
 * every non-English user gets the wrong branch — no error, no failing test.
 * So the kind is the contract, and the words are a message descriptor the
 * rendering surface resolves (docs/I18N-KEYS.md §9).
 */

/** Weekday tokens, indexed 0–6 Sunday-first (Date#getDay order). These are
 *  ICU `select` arguments, not display text: they name the day, and each
 *  surface's own `anchor` message turns them into words. */
export const WEEKDAY_TOKENS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

export type WeekdayToken = (typeof WEEKDAY_TOKENS)[number]

/** The anchor itself. `weekday` is 0–6 Sunday-first, same as Date#getDay. */
export type ScheduleAnchor =
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'weekday'; weekday: number }

/** The token an anchor renders through — stable, never compared for logic. */
export type ScheduleAnchorToken = 'today' | 'tomorrow' | WeekdayToken

/**
 * The time anchor for a scheduled day: today, tomorrow, the NEAREST scheduled
 * weekday (multiple weekdays pick the soonest, wrapping past Saturday), or
 * null when the day is unscheduled — the caller renders its own pre-schedule
 * "Up next" for null.
 *
 * `today` must be the USER'S local now: Date#getDay() reads the runtime's
 * local timezone, and the server's calendar day is not the user's (Vercel
 * renders in UTC), so every consumer computes this client-side after mount —
 * the same rule as `isSameLocalDay` (lib/local-day.ts).
 */
export function scheduleAnchor(weekdays: readonly number[], today: Date): ScheduleAnchor | null {
  // Tolerate junk defensively (external data may reach here pre-validation).
  const valid = weekdays.filter((w) => Number.isInteger(w) && w >= 0 && w <= 6)
  if (valid.length === 0) return null
  const dow = today.getDay()
  // Days until each scheduled weekday, 0..6; the minimum is the anchor.
  const delta = Math.min(...valid.map((w) => (w - dow + 7) % 7))
  if (delta === 0) return { kind: 'today' }
  if (delta === 1) return { kind: 'tomorrow' }
  return { kind: 'weekday', weekday: (dow + delta) % 7 }
}

/** The ICU `select` token an anchor's message switches on. */
export function scheduleAnchorToken(anchor: ScheduleAnchor): ScheduleAnchorToken {
  return anchor.kind === 'weekday' ? WEEKDAY_TOKENS[anchor.weekday] : anchor.kind
}
