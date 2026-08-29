import { z } from 'zod'
import type { Progression } from '../program-input'

/**
 * Overshoot / goal-met policy (#227) — HOW a completed set is credited against
 * its snapshotted prescription when the lifter beat the target on a different
 * axis (more reps at a lighter load, a heavier load at fewer reps):
 *
 *   'strict-load'      — a set counts only when performed AT the prescribed
 *                        load (the engine's historical behavior; StrongLifts /
 *                        Wendler doctrine: master a weight before you raise it).
 *   'e1rm-equivalent'  — a set counts when its estimated 1RM meets the
 *                        prescription's e1RM (equal stimulus = equal credit,
 *                        the hypertrophy reading).
 *   'any-metric'       — permissive: reps ≥ target reps OR load ≥ target load
 *                        OR e1RM ≥ target e1RM.
 *
 * The policy lives at PROGRAM level (it encodes the program's goal) with an
 * optional per-exercise override (strict on comp lifts, equivalent on
 * accessories). Null at both levels = the per-scheme default below. Scoring
 * always evaluates against the SNAPSHOTTED prescription values — never a
 * re-derivation (the autoreg "prescriptions are facts" rule).
 *
 * NOTE: weekly-volume is scored by SET COUNT, not per-set load/reps, so the
 * policy has nothing to credit there — it resolves (inertly) to strict.
 * Under EVERY policy, overshoot never auto-accelerates: exceeding the target
 * cannot skip progression steps or bump a training max beyond what the scheme
 * already does — at most it feeds the existing effort-step proposal path.
 */
export const overshootPolicySchema = z.enum(['strict-load', 'e1rm-equivalent', 'any-metric'])

export type OvershootPolicy = z.infer<typeof overshootPolicySchema>

type Scheme = Progression['scheme']

/**
 * The per-scheme default (research split, see the module note): load-anchored
 * schemes — linear, double-progression, rep-progression, percent-1rm,
 * amrap-cycle — read strict; rpe-target (whose prescriptions are themselves
 * e1RM-derived) reads e1rm-equivalent; weekly-volume is set-count scored so
 * the value is inert (strict). No scheme = strict.
 */
export function defaultOvershootPolicy(scheme: Scheme | null): OvershootPolicy {
  return scheme === 'rpe-target' ? 'e1rm-equivalent' : 'strict-load'
}

/**
 * Resolves the stored program/exercise policy columns into the policy the
 * engine applies — THE one code path between the stored text and behavior.
 * Exercise override > program policy > per-scheme default. Silence over
 * corruption: a value outside the union degrades to the next layer (never
 * throws, never half-applies), so an unknown blob behaves like null.
 */
export function resolveOvershootPolicy(
  programPolicy: unknown,
  exercisePolicy: unknown,
  scheme: Scheme | null,
): OvershootPolicy {
  const exercise = overshootPolicySchema.safeParse(exercisePolicy)
  if (exercise.success) return exercise.data
  const program = overshootPolicySchema.safeParse(programPolicy)
  if (program.success) return program.data
  return defaultOvershootPolicy(scheme)
}
