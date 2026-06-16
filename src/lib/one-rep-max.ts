/** Reps above this make the estimate unreliable; callers always label output "Est." */
export const MAX_RELIABLE_REPS = 12

/**
 * Estimated one-rep max (Epley) from a single set, in the same unit as `weightKg`.
 * Returns null for blank/invalid input. A single (reps === 1) IS its own 1RM, so
 * it's returned verbatim rather than Epley-inflated (Epley would give 1.033×w).
 */
export function estimate1RM(reps: number | null, weightKg: number | null): number | null {
  if (reps === null || weightKg === null) return null
  if (!Number.isFinite(reps) || !Number.isFinite(weightKg)) return null
  if (reps < 1 || weightKg <= 0) return null
  if (reps === 1) return weightKg
  return weightKg * (1 + reps / 30)
}

export interface BestSet {
  reps: number
  weightKg: number
  /** Estimated 1RM in kg (full precision; round only at display). */
  e1rm: number
}

/**
 * The set with the highest estimated 1RM from a list, or null when none have
 * both reps and weight. Ties resolve to the first (earliest) qualifying set.
 */
export function bestSet(
  sets: readonly { reps: number | null; weight: number | null }[],
): BestSet | null {
  let best: BestSet | null = null
  for (const s of sets) {
    const e1rm = estimate1RM(s.reps, s.weight)
    if (e1rm === null) continue
    if (best === null || e1rm > best.e1rm) {
      best = { reps: s.reps as number, weightKg: s.weight as number, e1rm }
    }
  }
  return best
}
