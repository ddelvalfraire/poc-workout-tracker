import { estimate1RM } from './one-rep-max'
import { displayToKg, type WeightUnit } from './units'
import type { LoggingType } from './workout-input'

/**
 * Live all-time-PR detection for the logger. Pure: the caller supplies the
 * draft's sets (display-unit strings), the exercise's logging type, and the
 * stored all-time best e1RM (kg, from the completed-workout corpus — an
 * in-progress session has completedAt null and can never be its own
 * baseline).
 */

/** The draft-set fields the detector reads — the logger keeps these as
 *  display-unit strings straight from the inputs. */
export interface PRCandidateSet {
  reps: string
  weight: string
  completed: boolean
}

/**
 * Index of the session's single best completed set IF it strictly beats the
 * all-time best e1RM — null otherwise ("flags exactly once").
 *
 * weight_reps only: the logger has no bodyweight value client-side, so
 * bodyweight-type loads are unknowable here and never flag. A null
 * `bestE1rmKg` means no baseline — a first-ever session claims no PR,
 * mirroring program-stats' derivePR. Ties keep the earliest set (in-session)
 * and never beat an equal record (strictly-greater everywhere).
 */
/**
 * Unit round-trip tolerance: lb display values round to 1dp, which can round
 * UP — re-entering your own record in lb converts back to slightly MORE kg
 * (≈0.02 kg on the weight, amplified by Epley), which must not read as a
 * phantom PR. 0.1 kg absorbs the worst rounding drift while the smallest real
 * increment (a 0.25 kg plate pair) still clears it comfortably.
 */
const E1RM_EPSILON_KG = 0.1

export function allTimePRIndex(
  sets: readonly PRCandidateSet[],
  loggingType: LoggingType,
  unit: WeightUnit,
  bestE1rmKg: number | null,
): number | null {
  if (loggingType !== 'weight_reps') return null
  if (bestE1rmKg === null || !Number.isFinite(bestE1rmKg)) return null

  let winnerIndex: number | null = null
  let winnerE1rm = -Infinity
  for (const [index, set] of sets.entries()) {
    if (!set.completed) continue
    // Number, not parseFloat: '12abc' must be rejected, not read as 12.
    // Blank strings are forced to NaN first (Number('') is 0, not blank).
    const reps = set.reps.trim() === '' ? NaN : Number(set.reps)
    const weight = set.weight.trim() === '' ? NaN : Number(set.weight)
    const e1rm = estimate1RM(reps, Number.isFinite(weight) ? displayToKg(weight, unit) : null)
    if (e1rm === null) continue
    if (e1rm > winnerE1rm) {
      winnerE1rm = e1rm
      winnerIndex = index
    }
  }

  return winnerIndex !== null && winnerE1rm > bestE1rmKg + E1RM_EPSILON_KG ? winnerIndex : null
}
