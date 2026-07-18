import { estimate1RM } from './one-rep-max'
import { displayToKg, type WeightUnit } from './units'
import type { LoggingType, WorkoutSetType } from './workout-input'

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
  /** Warm-up tag; absent = working (pre-tag callers keep their shape). */
  tag?: WorkoutSetType
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

/** Plain decimal digits only ("5", "102.5") — no sign, hex, exponent, or
 *  trailing junk. */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/

function parseDecimal(text: string): number | null {
  const trimmed = text.trim()
  return DECIMAL_PATTERN.test(trimmed) ? Number(trimmed) : null
}

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
    // Warm-ups are preparation, not record attempts — never PR candidates.
    if (set.tag === 'warmup') continue
    // Strict decimal parse, stricter than BOTH Number() (which accepts hex —
    // Number('0x12') is 18) and the save path's parseInt/parseFloat (which
    // prefix-parse '12abc' as 12): the detector must never score more than
    // what will persist. Reps must be a whole number for the same reason —
    // the save path truncates '5.9' to 5, and a flag earned on 5.9 would be
    // a phantom once saved.
    const reps = parseDecimal(set.reps)
    if (reps === null || !Number.isInteger(reps)) continue
    const weight = parseDecimal(set.weight)
    const e1rm = estimate1RM(reps, weight !== null ? displayToKg(weight, unit) : null)
    if (e1rm === null) continue
    if (e1rm > winnerE1rm) {
      winnerE1rm = e1rm
      winnerIndex = index
    }
  }

  return winnerIndex !== null && winnerE1rm > bestE1rmKg + E1RM_EPSILON_KG ? winnerIndex : null
}
