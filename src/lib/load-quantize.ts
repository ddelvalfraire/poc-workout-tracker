import { displayToKg, kgToDisplay, type WeightUnit } from './units'

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
 * Zero, negative, and non-finite input clamp to 0.
 */
export function quantizeLoadKg(kg: number, unit: WeightUnit): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0
  if (unit === 'kg') {
    // 1.25 is dyadic (5/4), so its multiples are float-exact.
    return Math.round(kg / LOAD_INCREMENT_KG) * LOAD_INCREMENT_KG
  }
  const lb = Math.round(kgToDisplay(kg, 'lb') / LOAD_INCREMENT_LB) * LOAD_INCREMENT_LB
  return displayToKg(lb, 'lb')
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
