/** Formats a workout's date for display, e.g. "Jun 14, 2026" (server locale). */
export function formatWorkoutDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

/**
 * Formats a logged set's reps/weight for display. `null` means the field was
 * left blank when logging.
 *   (5, 100) → "5 × 100 kg"   (5, null) → "5 reps"
 *   (null, 100) → "100 kg"    (null, null) → "—"
 */
export function formatSet(reps: number | null, weight: number | null): string {
  if (reps !== null && weight !== null) return `${reps} × ${weight} kg`
  if (reps !== null) return `${reps} reps`
  if (weight !== null) return `${weight} kg`
  return '—'
}
