/**
 * What un-completing one session would DRAG WITH IT — the SHAPE and the
 * predicate, with no database behind them.
 *
 * Split from `@/db/uncomplete-cascade` (which computes it) for the same
 * reason `workout-changelog-view.ts` is split from the events module: the
 * guard component runs in the browser, and importing the db module there
 * drags Postgres into the bundle. The io half imports these, so there is one
 * definition, not a copy that can drift.
 */
export interface UncompleteCascade {
  /** The block's week now, and the week it would fall back to. Null when the
   *  week axis does not move — the common case. */
  weekRollback: { from: number; to: number } | null
  /** The block reads finished today and would stop reading finished. */
  blockReopens: boolean
}

/** Nothing moves. Un-complete straight away; show no dialog. */
export const NO_CASCADE: UncompleteCascade = { weekRollback: null, blockReopens: false }

/** Whether this cascade is worth spending an interruption on. A modal that
 *  fires every time is a modal nobody reads. */
export function hasCascade(cascade: UncompleteCascade): boolean {
  return cascade.weekRollback !== null || cascade.blockReopens
}
