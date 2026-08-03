/**
 * Rest-countdown edge detection and mid-rest offset arithmetic — pure and
 * IO-free so the once-per-period contract unit-tests without browser APIs
 * (the vibration/audio/title side effects live in the logger's
 * rest-over-alert module and receive only the boolean from here).
 */

/** Vibration pattern for the rest-over alert (ms on/off/on). */
export const REST_OVER_VIBRATION = [100, 50, 100]

/** One tap of the mid-rest −15/+15 quick-adjust strip, in seconds. */
export const REST_ADJUST_STEP_SEC = 15

/**
 * The countdown target after applying the CURRENT period's quick-adjust
 * offset. Floors at 0 (a target can be shortened to "over now", never into
 * negative prescription); a null base stays null — with no target there is
 * nothing to adjust, only skip.
 */
export function adjustedRestTarget(baseSec: number | null, offsetSec: number): number | null {
  if (baseSec === null) return null
  return Math.max(0, baseSec + offsetSec)
}

export interface RestEdgeDetector {
  /**
   * Feed one countdown observation; returns true exactly when the rest-over
   * alert should fire. `periodKey` identifies the rest period (the logger
   * uses restStartedAt's epoch ms) — a new key resets the detector.
   */
  observe(periodKey: number, remainingSec: number): boolean
}

/**
 * Detects the remaining > 0 → ≤ 0 edge, ONCE per rest period.
 *
 * Firing requires having SEEN this period with time remaining: a detector
 * that (re)mounts mid-overage observes ≤ 0 first and stays silent — that
 * guards component re-mounts, StrictMode's double effect runs (the second
 * observe of the same crossing hits the fired latch), and restored sessions.
 * Once fired the latch holds for the period even if a +15 adjustment pushes
 * the countdown back positive — one period, one alert, by design.
 */
export function createRestEdgeDetector(): RestEdgeDetector {
  let currentKey: number | null = null
  let sawPositive = false
  let fired = false
  return {
    observe(periodKey, remainingSec) {
      if (periodKey !== currentKey) {
        currentKey = periodKey
        sawPositive = false
        fired = false
      }
      if (remainingSec > 0) {
        sawPositive = true
        return false
      }
      if (fired || !sawPositive) return false
      fired = true
      return true
    },
  }
}
