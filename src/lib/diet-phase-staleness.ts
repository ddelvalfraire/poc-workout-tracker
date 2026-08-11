import type { DietPhase } from '@/lib/program-input'

/**
 * The "still cutting?" staleness brain — pure, fed by the program page.
 *
 * Only CUTTING goes stale: a cut is definitionally time-boxed (the stall
 * reframes and held backoffs it triggers should not run forever on a
 * forgotten flag), while maintenance is indefinite by definition and long
 * bulks are ordinary. diet_phase_set_at is the honest anchor — every
 * explicit phase write stamps it (db/program-patches.ts). A cutting phase
 * with NO stamp (rows predating the column) stays silent: no anchor, no
 * accusation — the next explicit write starts the clock.
 */

/** Whole weeks of cutting before the page asks "still cutting?" — past the
 *  typical 8–12-week cut's lower bound, so the common case never nags. */
export const CUT_STALE_WEEKS = 8

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Whole weeks since the cut was last affirmed, when that's stale enough to
 * ask about — null otherwise (not cutting, no anchor, or fresh enough).
 */
export function cuttingStalenessWeeks(
  phase: DietPhase | null,
  setAt: Date | null,
  now: Date,
): number | null {
  if (phase !== 'cutting' || setAt === null) return null
  const weeks = Math.floor((now.getTime() - setAt.getTime()) / WEEK_MS)
  return weeks >= CUT_STALE_WEEKS ? weeks : null
}
