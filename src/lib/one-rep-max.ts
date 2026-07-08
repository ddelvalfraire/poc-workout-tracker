import type { LoggingType } from './workout-input'

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
 *
 * Reads `weight` as the total load — correct only for weight_reps exercises.
 * Logging-type-aware callers (summary page, MCP reads) use `bestScoredSet`;
 * this stays exported for API stability and for the program progression
 * engine, whose suggestions are weight_reps by definition.
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

/**
 * What a set actually loaded, in kg, given its exercise's logging type — the
 * translation layer between the stored `weight` column (whose meaning varies
 * by type) and anything that scores absolute load (e1RM, PRs).
 *
 * Every bodyweight type needs a known bodyweight; without one (or with a
 * non-positive/corrupt value) the load is unknowable → null, and callers fall
 * back to rep-based comparison. Assistance at or beyond bodyweight also
 * yields null: a non-positive "load" would poison the Epley estimate.
 */
export function effectiveLoadKg(
  loggingType: LoggingType,
  weightKg: number | null,
  bodyweightKg: number | null,
): number | null {
  if (loggingType === 'weight_reps') return weightKg
  if (bodyweightKg === null || !Number.isFinite(bodyweightKg) || bodyweightKg <= 0) return null
  switch (loggingType) {
    case 'bodyweight_reps':
      return bodyweightKg
    case 'weighted_bodyweight':
      return bodyweightKg + (weightKg ?? 0)
    case 'assisted_bodyweight': {
      const load = bodyweightKg - (weightKg ?? 0)
      return load > 0 ? load : null
    }
  }
}

/**
 * The best set of an exercise, scored one of two ways:
 *   'e1rm' — highest estimated 1RM over the EFFECTIVE load (ties → earliest),
 *            same policy as `bestSet`; `weightKg` is that effective load.
 *   'reps' — most reps (reps ≥ 1; ties → earliest). Used ONLY when no set is
 *            e1rm-scorable — bodyweight work with no stored bodyweight, or
 *            sets logged without weight ("top set" must still work when a
 *            user enters no weight).
 * `index` addresses the winning set in the input list. Null when nothing is
 * scorable either way.
 */
export type ScoredBestSet =
  | { kind: 'e1rm'; index: number; reps: number; weightKg: number; e1rm: number }
  | { kind: 'reps'; index: number; reps: number }

export function bestScoredSet(
  sets: readonly { reps: number | null; weight: number | null }[],
  loggingType: LoggingType,
  bodyweightKg: number | null,
): ScoredBestSet | null {
  let bestLoad: (ScoredBestSet & { kind: 'e1rm' }) | null = null
  for (const [index, s] of sets.entries()) {
    const load = effectiveLoadKg(loggingType, s.weight, bodyweightKg)
    const e1rm = estimate1RM(s.reps, load)
    if (e1rm === null) continue
    // Strictly-greater keeps ties on the earliest set, matching bestSet.
    if (bestLoad === null || e1rm > bestLoad.e1rm) {
      bestLoad = { kind: 'e1rm', index, reps: s.reps as number, weightKg: load as number, e1rm }
    }
  }
  if (bestLoad !== null) return bestLoad

  // Rep fallback: nothing was load-scorable, so the heaviest thing left to
  // compare is rep count. Same strictly-greater tie policy.
  let bestReps: (ScoredBestSet & { kind: 'reps' }) | null = null
  for (const [index, s] of sets.entries()) {
    if (s.reps === null || !Number.isInteger(s.reps) || s.reps < 1) continue
    if (bestReps === null || s.reps > bestReps.reps) {
      bestReps = { kind: 'reps', index, reps: s.reps }
    }
  }
  return bestReps
}
