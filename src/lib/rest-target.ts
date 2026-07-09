/**
 * Rest-target resolution for the logger's countdown — pure, IO-free, so the
 * precedence chain unit-tests as a plain function (mirroring `format.ts`'s
 * placeholder helpers, which own the same plan-slot indexing rules).
 *
 * Precedence: the just-completed set's PLAN restSec (per-set granularity — the
 * finest grain the program tree offers) > the user's session default > null
 * (no target: the readout stays a plain count-up).
 */

/** The one plan field this module reads — satisfied by `PlanSetTarget`. */
export interface RestTargetSource {
  restSec: number | null
}

/**
 * The rest target (seconds) to count down after completing set `setIndex`, or
 * null for a plain count-up.
 *
 * Index overflow mirrors `placeholderForSet` exactly: a set index beyond the
 * plan (more sets logged than planned) has NO plan slot — it does not clamp to
 * the last planned set — so extra sets fall through to the session default,
 * the same way their ghosts fall through to nothing. A plan slot whose restSec
 * is null (set exists, rest unprescribed) falls through the same way.
 */
export function resolveRestTarget(
  planTargets: readonly RestTargetSource[] | undefined,
  setIndex: number,
  sessionDefault: number | null,
): number | null {
  return planTargets?.[setIndex]?.restSec ?? sessionDefault ?? null
}
