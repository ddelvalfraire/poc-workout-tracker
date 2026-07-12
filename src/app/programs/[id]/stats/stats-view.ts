import { MAX_RELIABLE_REPS } from '@/lib/one-rep-max'
import type {
  ProgramWeekStats,
  ProgramExercisePR,
  ProgramExercisePRPoint,
} from '@/db/program-stats'

/**
 * Pure view logic for the program stats page — kept free of JSX so it
 * unit-tests as plain functions (same convention as ../week-view).
 * Everything stays in the kg domain; display conversion happens in the
 * page's format helpers.
 */

/** A week is "all-zero" when nothing was even started — a week with only an
 *  empty started workout still shows (started counts). */
function isZeroWeek(w: ProgramWeekStats): boolean {
  return w.daysStarted === 0 && w.completedSets === 0
}

/**
 * The weeks worth rendering: trims trailing all-zero future weeks (an
 * untouched 7-week block shouldn't render 7 empty rows) but never below
 * `currentWeek`, and always keeps any later week that carries data (manual
 * overshoot included). Returns a new array; relies on the data layer's
 * materialized 1..N shape (`weeks[i].week === i + 1`).
 */
export function visibleWeeks(
  weeks: readonly ProgramWeekStats[],
  currentWeek: number,
): ProgramWeekStats[] {
  let last = weeks.length
  while (last > currentWeek && isZeroWeek(weeks[last - 1])) last--
  return weeks.slice(0, last)
}

/**
 * A week's volume bar width as a whole percent of the block's max tonnage.
 * A zero max (machine-only or empty block) yields 0, never NaN/Infinity.
 */
export function volumeBarWidthPct(tonnageKg: number, maxTonnageKg: number): number {
  if (maxTonnageKg <= 0) return 0
  return Math.round((tonnageKg / maxTonnageKg) * 100)
}

/** Whether the block has any training at all — false drives the whole-page
 *  teach empty state. Started days count even before any set completes. */
export function hasAnyTraining(weeks: readonly ProgramWeekStats[]): boolean {
  return weeks.some((w) => !isZeroWeek(w))
}

/** The block's e1RM gain for one exercise, kg (0 for a single scored week —
 *  baseline and best are the same point). Never negative: best ≥ baseline
 *  by construction. */
export function prDeltaKg(pr: ProgramExercisePR): number {
  return pr.best.e1rm - pr.baseline.e1rm
}

/** Whether a PR endpoint's estimate came from a rep count past the reliable
 *  Epley range — the UI flags these rather than presenting them as solid. */
export function isHighRepEstimate(point: ProgramExercisePRPoint): boolean {
  return point.reps > MAX_RELIABLE_REPS
}
