export type WeightUnit = 'kg' | 'lb'
export const WEIGHT_UNITS = ['kg', 'lb'] as const satisfies readonly WeightUnit[]
// Product default for a user with no saved preference. Weights are still stored
// canonically in kg; this only governs what an unconfigured user sees/enters.
export const DEFAULT_WEIGHT_UNIT: WeightUnit = 'lb'

// 1 lb = 0.45359237 kg (exact, NIST).
const KG_PER_LB = 0.45359237

/** Narrows untrusted input (server-action payloads, DB text) to a WeightUnit. */
export function isWeightUnit(value: unknown): value is WeightUnit {
  return value === 'kg' || value === 'lb'
}

/** Rounds a display weight to 1 decimal place (e.g. 220.46→220.5, 100→100). */
function roundForDisplay(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Converts a stored kg weight into the display unit. kg is the canonical stored
 * unit, so it's returned verbatim (a true identity — full precision preserved);
 * only the lb conversion, which is irrational, is rounded for display.
 */
export function kgToDisplay(weightKg: number, unit: WeightUnit): number {
  return unit === 'lb' ? roundForDisplay(weightKg / KG_PER_LB) : weightKg
}

/** Converts a value entered in the display unit back to kg, at column precision (2dp). */
export function displayToKg(value: number, unit: WeightUnit): number {
  const kg = unit === 'lb' ? value * KG_PER_LB : value
  return Math.round(kg * 100) / 100 // sets.weight is numeric(6,2)
}

// ── Lengths (body measurements) ──────────────────────────────────────────────
// Same canonical-unit discipline as weights: cm stored, display unit derived.

export type LengthUnit = 'cm' | 'in'

// 1 in = 2.54 cm (exact, by definition).
const CM_PER_IN = 2.54

/**
 * The length display unit is INFERRED from the weight unit preference — one
 * preference governs both (lb users measure in inches, kg users in cm).
 * There is deliberately no separate length-unit setting.
 */
export function lengthUnitFor(weightUnit: WeightUnit): LengthUnit {
  return weightUnit === 'lb' ? 'in' : 'cm'
}

/**
 * Converts a stored cm length into the display unit. cm is canonical, so it's
 * returned verbatim (full precision); only the inch conversion is rounded to
 * 1dp for display — mirroring kgToDisplay.
 */
export function cmToDisplay(valueCm: number, unit: LengthUnit): number {
  return unit === 'in' ? Math.round((valueCm / CM_PER_IN) * 10) / 10 : valueCm
}

/** Converts a value entered in the display unit back to cm, at column precision (2dp). */
export function displayToCm(value: number, unit: LengthUnit): number {
  const cm = unit === 'in' ? value * CM_PER_IN : value
  return Math.round(cm * 100) / 100 // body_measurements.value_cm is numeric(5,2)
}
