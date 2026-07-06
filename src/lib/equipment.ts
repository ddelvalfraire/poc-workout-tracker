import { isWeightUnit, type WeightUnit } from './units'

/**
 * The user's physical loading equipment for the plate calculator: which bars
 * they have and which plate DENOMINATIONS they own (not counts — unlimited
 * pairs of each are assumed). Values live in the unit the gear is stamped
 * with, so equipment is stored alongside its unit and never converted — a
 * 45 lb plate is not a 20.4 kg plate. When the stored unit doesn't match the
 * user's active display unit, readers fall back to that unit's defaults.
 */

export interface Equipment {
  /** Bar weights, heaviest first. The "no bar" option is UI-level (bar = 0), not stored. */
  bars: number[]
  /** Plate denominations owned, heaviest first. */
  plates: number[]
}

/** What a commercial gym stocks, per unit — the zero-setup starting point. */
export const DEFAULT_EQUIPMENT: Record<WeightUnit, Equipment> = {
  lb: { bars: [45, 35], plates: [45, 35, 25, 10, 5, 2.5] },
  kg: { bars: [20, 15], plates: [25, 20, 15, 10, 5, 2.5, 1.25] },
}

// Sanity bounds, not physics: heavier than any real plate/bar rejects typos
// like "455". Applied in the unit the value was entered in.
const MAX_WEIGHT = 150
const MAX_BARS = 6
const MAX_PLATES = 12

/** The jsonb shape stored in `user_preferences.equipment`. */
export interface StoredEquipment extends Equipment {
  unit: WeightUnit
}

function parseWeights(raw: unknown, field: string, max: number): number[] {
  if (!Array.isArray(raw)) throw new Error(`equipment ${field} must be an array`)
  if (raw.length === 0) throw new Error(`equipment ${field} must not be empty`)
  if (raw.length > max) throw new Error(`equipment ${field} must have at most ${max} entries`)
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_WEIGHT) {
      throw new Error(`equipment ${field} entries must be numbers between 0 and ${MAX_WEIGHT}`)
    }
  }
  // Dedupe + heaviest first — the canonical order every consumer expects.
  return Array.from(new Set(raw as number[])).sort((a, b) => b - a)
}

/**
 * Trust boundary for equipment writes: validates untrusted input into a fresh
 * normalized `StoredEquipment` or throws with a clear message. Mirrors
 * `parseWorkoutInput`'s stance — nothing is coerced silently.
 */
export function parseEquipmentInput(input: unknown): StoredEquipment {
  if (!input || typeof input !== 'object') throw new Error('equipment must be an object')
  const obj = input as Record<string, unknown>
  if (!isWeightUnit(obj.unit)) throw new Error("equipment unit must be 'kg' or 'lb'")
  return {
    unit: obj.unit,
    bars: parseWeights(obj.bars, 'bars', MAX_BARS),
    plates: parseWeights(obj.plates, 'plates', MAX_PLATES),
  }
}

/**
 * Read-side guard: stored jsonb is untrusted, and equipment entered under a
 * different unit is physically meaningless for the active one — both fall
 * back to the active unit's defaults.
 */
export function equipmentForUnit(stored: unknown, unit: WeightUnit): Equipment {
  try {
    const parsed = parseEquipmentInput(stored)
    if (parsed.unit !== unit) return DEFAULT_EQUIPMENT[unit]
    return { bars: parsed.bars, plates: parsed.plates }
  } catch {
    return DEFAULT_EQUIPMENT[unit]
  }
}
