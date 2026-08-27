import { resolveDayState } from '../week-view'

/**
 * Trained history as the editor reads it
 * (docs/specs/trained-history-in-the-editor.md), kept free of JSX so it
 * unit-tests as plain functions.
 *
 * THE UNIT IS THE DAY, NOT THE WEEK. `instantiateProgramDay` freezes
 * `prescribed*` on a workout's set rows once per (program day × week), one
 * transaction at a time, under a comment reading "no edit path may ever update
 * these". There is no week-wide snapshot event anywhere in the codebase, so in
 * a part-done week some days are frozen and some are not, and a week-level
 * indicator would be right about half of week 3 and wrong about the other half.
 * Everything here is therefore per-day; the week only ever REPORTS a count.
 *
 * SETTLED, NOT LOCKED. `setProgramSetOverride` and `updateProgramSet` have zero
 * trained-week awareness — the write always succeeds and is merely INERT for an
 * already-instantiated day. Nothing in this module or the surfaces reading it
 * may say "locked": that would describe an enforcement that does not exist.
 *
 * The state itself comes from `resolveDayState`, not from a second predicate
 * written here. Two derivations eventually disagree, and this one would
 * disagree with the day cards the user already reads on the detail page.
 */

/**
 * A day's state for one week, in the app's SHIPPED vocabulary.
 *
 * `null` is an untouched day in a current or future week — deliberately not
 * "skipped", which the app says only of an untouched day in a PAST week.
 */
export type TrainedDayState = 'done' | 'in-progress' | 'skipped' | null

/** The rows `listProgramWorkouts` returns, narrowed to what state needs. */
export interface TrainedWorkoutRow {
  programDayId: string | null
  programWeek: number | null
  startedAt: Date
  completedAt: Date | null
}

/**
 * One day's state for one week.
 *
 * `isPastWeek` gates "Skipped" and nothing else: an untouched day is only
 * skipped once its week is behind you. Saying it of the current or a future
 * week would accuse the user of missing a session they can still train.
 */
export function trainedDayState(
  rows: readonly TrainedWorkoutRow[],
  isPastWeek: boolean,
): TrainedDayState {
  const resolved = resolveDayState([...rows])
  if (resolved === null) return isPastWeek ? 'skipped' : null
  return resolved.state === 'completed' ? 'done' : 'in-progress'
}

/**
 * Whether a day's prescription is FROZEN — whether today's edit can still reach
 * it.
 *
 * An in-progress session counts, and the intuition runs exactly backwards here:
 * its sets were inserted at start time and resuming returns the existing rows
 * untouched, so a session you have started but not finished is as settled as a
 * finished one. That is the single fact a naive implementation gets wrong, so
 * it lives in a named predicate rather than in a comparison at each call site.
 */
export function isSettled(state: TrainedDayState): boolean {
  return state === 'done' || state === 'in-progress'
}

/** What a week's header REPORTS — a count, never a tri-state control. */
export interface WeekTrainedReport {
  /** Days of the week whose session is settled (done or in progress). */
  trained: number
  /** Days in the program. */
  total: number
  /** Every day settled AND at least one day to settle. */
  allTrained: boolean
}

/**
 * The week's count.
 *
 * A count, because "mixed" is a state a user can leave but never enter: an
 * indeterminate control's entire semantic is "toggle my children", which is
 * exactly the operation that must be forbidden here. A count also survives
 * translation, screen readers and colour blindness, none of which a dash does.
 */
export function weekTrainedReport(states: readonly TrainedDayState[]): WeekTrainedReport {
  const trained = states.filter(isSettled).length
  return {
    trained,
    total: states.length,
    allTrained: states.length > 0 && trained === states.length,
  }
}

/**
 * Where the labelled "now" seam goes in the day list: the index of the first
 * editable row, or null when there is no honest place for one.
 *
 * The seam is the encoding every reader already knows from every timeline they
 * have seen, and it is only truthful when the settled days form a contiguous
 * PREFIX — a rule that says "everything below this line is still editable" is a
 * lie the moment a settled day sits below it. Days are trained in whatever
 * order the user trains them, so that is a real case, not a defensive one.
 *
 * Null therefore means "draw no rule", and the boundary is carried entirely by
 * the other two channels the spec requires: the change in FORM (log rendering
 * versus input rendering) and the shipped word on each settled row. Null also
 * covers the two degenerate cases — nothing settled (no boundary yet) and
 * everything settled (no editable side to point at).
 */
export function trainedSeamIndex(states: readonly TrainedDayState[]): number | null {
  const firstEditable = states.findIndex((state) => !isSettled(state))
  if (firstEditable <= 0) return null
  // A settled day below the first editable one means the settled days are not a
  // prefix, and no single rule can describe the split.
  if (states.slice(firstEditable).some(isSettled)) return null
  return firstEditable
}
