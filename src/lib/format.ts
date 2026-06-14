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
