/**
 * Rest-target resolution for the logger's countdown — pure, IO-free, so the
 * precedence chain unit-tests as a plain function (mirroring `format.ts`'s
 * placeholder helpers).
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
 * The rest target (seconds) to count down after completing the set whose plan
 * slot is `target`, or null for a plain count-up.
 *
 * The caller resolves the slot itself — `resolvePlanTarget` in format.ts is
 * the ONE pairing definition (role-aware: warm-ups never consume a working
 * slot), and this module must not grow a second, positional copy of it. A set
 * with no plan slot (extra sets beyond the plan, ad-hoc exercises) passes
 * undefined and falls through to the session default, the same way its ghosts
 * fall through to nothing. A slot whose restSec is null (set exists, rest
 * unprescribed) falls through the same way.
 */
export function resolveRestTarget(
  target: RestTargetSource | undefined,
  sessionDefault: number | null,
): number | null {
  return target?.restSec ?? sessionDefault ?? null
}
