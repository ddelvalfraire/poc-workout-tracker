/** Formats a workout's date for display, e.g. "Jun 14, 2026" (server locale). */
export function formatWorkoutDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

import { kgToDisplay, type WeightUnit } from './units'

/**
 * Formats a logged set's reps/weight for display. Weight is stored in kg and
 * converted to the caller's `unit` (default kg). `null` means the field was
 * left blank when logging.
 *   (5, 100) → "5 × 100 kg"           (5, null) → "5 reps"
 *   (5, 100, 'lb') → "5 × 220.5 lb"   (null, null) → "—"
 */
export function formatSet(
  reps: number | null,
  weightKg: number | null,
  unit: WeightUnit = 'kg',
): string {
  const weight = weightKg !== null ? `${kgToDisplay(weightKg, unit)} ${unit}` : null
  if (reps !== null && weight !== null) return `${reps} × ${weight}`
  if (reps !== null) return `${reps} reps`
  if (weight !== null) return weight
  return '—'
}

/**
 * Formats an estimated 1RM (stored-kg) for display in the active unit, e.g.
 *   117 (kg) → "117 kg"      117 (lb) → "258 lb"
 * Rounds via kgToDisplay (kg identity, lb to 1dp), matching formatSet.
 */
export function formatE1RM(e1rmKg: number, unit: WeightUnit = 'kg'): string {
  return `${kgToDisplay(e1rmKg, unit)} ${unit}`
}

/**
 * Ghost-input placeholders for set position `index`, from a prior performance
 * (weights converted to the active unit). Returns `{}` when there's no history,
 * no prior set at that index (more sets than last time), or a field was blank
 * last time — so the caller can spread the result onto the inputs and any unset
 * field renders no ghost (an `undefined` `placeholder` is omitted by React).
 */
export function placeholderForSet(
  last: { sets: { reps: number | null; weight: number | null }[] } | null,
  index: number,
  unit: WeightUnit = 'kg',
): { reps?: string; weight?: string } {
  const prior = last?.sets[index]
  if (!prior) return {}
  return {
    reps: prior.reps !== null ? String(prior.reps) : undefined,
    weight: prior.weight !== null ? String(kgToDisplay(prior.weight, unit)) : undefined,
  }
}

/** A planned set's ghostable targets, in stored kg (from the program's
 *  engine-derived prescription for the workout's week). */
export interface PlanSetTarget {
  repMin: number | null
  repMax: number | null
  loadKg: number | null
}

/**
 * Ghost-input placeholders for set position `index` from the day's PLAN — the
 * fallback when there's no prior performance to ghost from (e.g. a machine
 * lift's first session). Rep ranges render as "8–12" (placeholders are display
 * text, not values, so a number input accepts the en dash). Same `{}` /
 * `undefined` contract as `placeholderForSet`.
 */
export function planPlaceholderForSet(
  targets: readonly PlanSetTarget[] | undefined,
  index: number,
  unit: WeightUnit = 'kg',
): { reps?: string; weight?: string } {
  const target = targets?.[index]
  if (!target) return {}
  let reps: string | undefined
  if (target.repMin !== null && target.repMax !== null) {
    reps = target.repMin === target.repMax ? String(target.repMin) : `${target.repMin}–${target.repMax}`
  } else {
    const single = target.repMin ?? target.repMax
    reps = single !== null ? String(single) : undefined
  }
  return {
    reps,
    weight: target.loadKg !== null ? String(kgToDisplay(target.loadKg, unit)) : undefined,
  }
}
