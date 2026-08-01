/**
 * Pure client-safe rules for the home page's "body check-in due" card, split
 * from lib/check-in.ts because THAT module imports the db layer — a client
 * component may import this file only. Kept pure so the visibility rule and
 * the dismiss key are testable without a DOM.
 */

/**
 * Show only when a check-in is actually due and the user hasn't dismissed the
 * card today. Due-ness comes from the server (getCheckInStatus); dismissal is
 * client session state — the quiet card must never outlive the day it was
 * waved away, and never persist anywhere.
 */
export function shouldShowCheckInCard(isDue: boolean, dismissedToday: boolean): boolean {
  return isDue && !dismissedToday
}

/**
 * The sessionStorage key for dismiss-for-today, on the LOCAL calendar day —
 * "today" is the user's day, not the server's (the local-day.ts principle).
 * A new local day mints a new key, so yesterday's dismissal expires silently.
 */
export function checkInDismissKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `checkin-card-dismissed:${now.getFullYear()}-${month}-${day}`
}

/** The card's detail line: recency when known, a first-time nudge when not. */
export function checkInCardDetail(daysSinceLast: number | null): string {
  if (daysSinceLast === null) return 'first one for this program'
  if (daysSinceLast === 0) return 'last was today'
  if (daysSinceLast === 1) return 'last was yesterday'
  return `last was ${daysSinceLast} days ago`
}
