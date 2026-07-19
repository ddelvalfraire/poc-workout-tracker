import { bestScoredSet } from './one-rep-max'
import type { LoggingType } from './workout-input'

/**
 * Which set of a displayed session history entry is its "best" — shared by
 * the logger's stats sheet and the exercise stats page so the two surfaces
 * can never disagree about the marked set.
 *
 * Eligibility mirrors the scoring invariant in db/exercise-stats: only
 * completed, reps_weight-metric, non-warm-up sets can win. Scoring itself is
 * `bestScoredSet` (highest e1RM over effective load, rep-count fallback), so
 * the mark matches the records the same rows produced.
 */

/** The session-history set fields the picker reads (matches ExerciseSession
 *  rows; `setType` optional for callers whose rows predate the column). */
export interface SessionSetLike {
  reps: number | null
  weight: number | null // kg
  completed: boolean
  metricMode: string
  /** 'working' | 'warmup' — warm-ups never win the mark. */
  setType?: string
}

export interface SessionBestSet {
  /** Index into the ORIGINAL sets array as passed (not the scorable subset). */
  index: number
  /** Estimated 1RM in kg when load-scorable; null on the rep-count fallback. */
  e1rmKg: number | null
}

/**
 * The best set of one session's displayed rows, or null when nothing is
 * scorable (all warm-up/uncompleted/duration, or no reps anywhere).
 * `bodyweightKg` defaults to null: without it, bodyweight logging types fall
 * back to rep comparison — same degradation as the rest of the scoring stack.
 */
export function sessionBestSet(
  sets: readonly SessionSetLike[],
  loggingType: LoggingType,
  bodyweightKg: number | null = null,
): SessionBestSet | null {
  // Map scorable rows back to their original indices: bestScoredSet addresses
  // the list it was given, but callers mark sets in the full display list.
  const scorable: { index: number; reps: number | null; weight: number | null }[] = []
  sets.forEach((set, index) => {
    if (!set.completed || set.metricMode !== 'reps_weight' || set.setType === 'warmup') return
    scorable.push({ index, reps: set.reps, weight: set.weight })
  })
  const best = bestScoredSet(scorable, loggingType, bodyweightKg)
  if (best === null) return null
  return {
    index: scorable[best.index].index,
    e1rmKg: best.kind === 'e1rm' ? best.e1rm : null,
  }
}
