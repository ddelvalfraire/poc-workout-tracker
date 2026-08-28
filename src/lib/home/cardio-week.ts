/**
 * The cardio-week widget's brain — pure, so the rounding and the comparison
 * rules are testable without a database or a renderer.
 *
 * Minutes, not seconds: a weekly conditioning total is read at a glance, and
 * nobody thinks in seconds at that scale. Rounding happens ONCE, here, so the
 * headline and the delta can never disagree — deriving the delta from
 * unrounded seconds and rounding it separately is how you get "96 min, +1 vs
 * last week" out of 95.6 and 95.1.
 */

export interface CardioWeek {
  /** Whole minutes in the current rolling window. */
  minutes: number
  /** Whole minutes gained or lost against the previous window, or null when
   *  there is nothing honest to compare against. */
  deltaMinutes: number | null
}

const SEC_PER_MIN = 60

/**
 * Returns null when the current window holds no cardio at all — the widget
 * then renders nothing. Absence, not a zero: a lifter who never logs a
 * duration set should not carry a permanent "0 min" tile.
 *
 * The delta is null when the PREVIOUS window was empty, because "+96" against
 * nothing is not a comparison, it is the same number wearing a plus sign.
 * That matches how the momentum panel already refuses a hollow
 * week-over-week line.
 */
export function cardioWeek(currentSec: number, previousSec: number): CardioWeek | null {
  const minutes = Math.round(currentSec / SEC_PER_MIN)
  // Sub-30-second totals round to zero; treat that as no cardio rather than
  // showing a tile whose headline is 0.
  if (minutes <= 0) return null
  const previousMinutes = Math.round(previousSec / SEC_PER_MIN)
  return {
    minutes,
    deltaMinutes: previousMinutes > 0 ? minutes - previousMinutes : null,
  }
}
