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
