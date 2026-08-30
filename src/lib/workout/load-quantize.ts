import { displayToKg, kgToDisplay, type WeightUnit } from '../units'

/**
 * Load quantization (#226): every SUGGESTED or DISPLAYED load must be a
 * number the lifter can actually put on a bar/stack — the engine once
 * suggested 37.2 lb and a reason string printed 66.6 lb, both kg-derived
 * values surfaced raw in lb. Loads snap to the display unit's standard
 * increment; stored kg facts (logged sets, performed history) stay exact —
 * quantization is a derivation/display boundary, never a mutation of history.
 */

/** Standard smallest total-load increments per display unit (a pair of
 *  1.25 lb / 0.625 kg change plates — the finest grid a normal gym loads). */
export const LOAD_INCREMENT_LB = 2.5
export const LOAD_INCREMENT_KG = 1.25

/**
 * Returns the kg value whose display conversion is the nearest multiple of
 * the unit's standard increment (ties round up). kg unit snaps the kg value
 * itself; lb snaps the converted display value, then round-trips back to kg
 * at column precision (2dp — within 0.011 lb, absorbed by 1dp display
 * rounding, so `kgToDisplay` of the result always lands ON the grid).
 * Zero, negative, and non-finite input clamp to 0; a strictly-POSITIVE load
 * clamps to a minimum of one increment — a real suggestion must never
 * quantize to 0 and vanish from plan strings (callers gate on > 0).
 */
export function quantizeLoadKg(kg: number, unit: WeightUnit): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0
  if (unit === 'kg') {
    // 1.25 is dyadic (5/4), so its multiples are float-exact.
    const snapped = Math.round(kg / LOAD_INCREMENT_KG) * LOAD_INCREMENT_KG
    return snapped > 0 ? snapped : LOAD_INCREMENT_KG
  }
  const lb = Math.round(kgToDisplay(kg, 'lb') / LOAD_INCREMENT_LB) * LOAD_INCREMENT_LB
  return displayToKg(lb > 0 ? lb : LOAD_INCREMENT_LB, 'lb')
}

/**
 * Quantizes an autoreg-ADJUSTED load against its pre-adjustment baseline,
 * breaking the light-load fixed point: a ~10–25% backoff at (say) 5 lb lands
 * on 3.75 lb, which rounds BACK to 5 lb — and since the quantized value
 * persists as next session's evidence, the load would never move while the
 * reason keeps claiming a backoff. When the quantized result equals the
 * quantized baseline but the raw adjustment intended a change, step one full
 * display increment in the intended direction. A reduction never steps below
 * one increment (the smallest loadable value is the floor). Callers apply
 * this ONLY to intended changes (step/decrement) — never to repeat caps or
 * anchors, which legitimately re-prescribe the same number.
 */
export function quantizeAdjustedLoadKg(
  rawKg: number,
  baselineKg: number,
  unit: WeightUnit,
): number {
  const quantized = quantizeLoadKg(rawKg, unit)
  if (rawKg === baselineKg || quantized !== quantizeLoadKg(baselineKg, unit)) return quantized
  const increment = unit === 'kg' ? LOAD_INCREMENT_KG : LOAD_INCREMENT_LB
  const stepped = kgToDisplay(quantized, unit) + (rawKg < baselineKg ? -increment : increment)
  if (stepped <= 0) return quantized
  return displayToKg(stepped, unit)
}

/** Attempted-at-load tolerance (the engine's C2 epsilon). 0.05 kg absorbs
 *  lb→kg round-trip drift (an executed sweep showed stored-vs-prescribed
 *  drift up to 0.02 kg; the prior 0.011 excluded ~17% of legitimate at-load
 *  attempts) while micro-loading noise still can't hide a stall. Single home
 *  on purpose: the autoreg engine's scoring, the effort gate, and note
 *  re-anchoring must move together or not at all. */
export const LOAD_EPSILON_KG = 0.05

/**
 * Epsilon-or-increment load identity: raw values within `epsilonKg` always
 * match; with a unit, values that quantize to the SAME display increment
 * also match. The transitional bridge (#226): prescribed snapshots stamped
 * before quantization can sit up to ~half an increment from their quantized
 * re-derivation — far past the raw epsilon — yet they are the same load on
 * the only grid the lifter can actually set up.
 */
export function loadsMatch(a: number, b: number, epsilonKg: number, unit?: WeightUnit): boolean {
  if (Math.abs(a - b) <= epsilonKg) return true
  return unit !== undefined && quantizeLoadKg(a, unit) === quantizeLoadKg(b, unit)
}

/**
 * The quantized load in the DISPLAY unit — what reason strings, ghosts, and
 * planned-scheme lines print instead of a raw `kgToDisplay` (66.6 lb → 67.5).
 */
export function quantizeDisplayLoad(kg: number, unit: WeightUnit): number {
  return kgToDisplay(quantizeLoadKg(kg, unit), unit)
}

/**
 * Quantizes a derived set's suggested loads (`loadKg`, and the pre-autoreg
 * `schemeLoadKg` revert value when present) for `deriveDayPrescription` —
 * round-at-derivation, so ghosts, previews, and the prescribed snapshots
 * stamped at instantiation all compare like with like. Returns the input
 * object unchanged when nothing moves.
 */
export function quantizeSetLoads<
  T extends { loadKg: number | null; schemeLoadKg?: number | null },
>(set: T, unit: WeightUnit): T {
  const loadKg = set.loadKg === null ? null : quantizeLoadKg(set.loadKg, unit)
  const schemeLoadKg =
    set.schemeLoadKg == null ? set.schemeLoadKg : quantizeLoadKg(set.schemeLoadKg, unit)
  if (loadKg === set.loadKg && schemeLoadKg === set.schemeLoadKg) return set
  return { ...set, loadKg, schemeLoadKg }
}
