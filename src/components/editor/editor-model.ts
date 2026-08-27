import type { MetricMode, SetType } from '@/lib/program-input'
import type { LoggingType } from '@/lib/workout-input'
import type { TrainedDayState } from '@/app/programs/[id]/editor/trained-view'

/**
 * The presentational shapes the editor panes render. Types only — every
 * derivation lives in `src/app/programs/[id]/editor/editor-view.ts`, beside the
 * route that owns the data, the same way `block-weeks.ts` sits beside
 * `block-map.tsx`.
 *
 * The panes take view models rather than `ProgramDetail` rows on purpose: it is
 * what lets one component render in Storybook (the only place this surface can
 * be seen — the app cannot boot without WorkOS credentials) and in the app from
 * the same props, and it keeps unit conversion, week resolution and trained
 * state on the server where the facts are.
 */

/** One week in the structure pane's week list. */
export interface EditorWeek {
  /** 1-based. */
  week: number
  /** The block's planned deload week, per `programs.deloadWeek`. */
  isDeload: boolean
  /**
   * True when this week sits ABOVE `mesocycleWeeks` — a week the user really
   * trained that a later shrink pushed outside the block. It is listed because
   * dropping it would hide real history; the flag exists so the row can say
   * why it is there.
   */
  isBeyondBlock: boolean
}

/** One exercise's set, already unit-converted for display. */
export interface EditorSet {
  /** 1-based, from `programSets.setNumber`. */
  setNumber: number
  setType: SetType
  /** In the user's display unit; null when the template names no load. */
  load: number | null
  repMin: number | null
  repMax: number | null
  rir: number | null
  rpe: number | null
  /** True when a per-week override supplies the values above. */
  overridden: boolean
}

/** One exercise inside the addressed day. */
export interface EditorExercise {
  /** 0-based position — what the address's `?exercise=` carries. */
  position: number
  name: string
  sets: readonly EditorSet[]
}

/** One day row in the structure pane. */
export interface EditorDay {
  /** 0-based position — the address's path segment. */
  position: number
  name: string
  exerciseCount: number
  /**
   * This day's state for the SELECTED week, in the shipped vocabulary. The
   * freeze unit is a workout instantiation — one (day × week) — so the state
   * belongs here on the day row and never on the week.
   */
  trained: TrainedDayState
}

/**
 * One logged set — what the user actually did, beside what they were asked to.
 *
 * Both halves are stored on the same row by `instantiateProgramDay`, which
 * freezes `prescribed*` at start time under a comment reading "no edit path may
 * ever update these". That is what makes the pair comparable: the prescription
 * shown here is the one this session was seeded with, not today's template,
 * which may have moved since.
 *
 * Weights are the STORED kg in the `weight` column's own semantics, left for
 * the component to format with the exercise's `loggingType` — the same
 * `formatSet` the workout detail page uses. Both numbers come from that one
 * column, so comparing them is like for like.
 */
export interface EditorLoggedSet {
  /** 1-based. */
  setNumber: number
  completed: boolean
  reps: number | null
  /** kg as stored; the component converts and formats. */
  weight: number | null
  metricMode: MetricMode
  durationSec: number | null
  distanceM: number | null
  /** The frozen target, or null on an ad-hoc set and all pre-snapshot history. */
  prescribedReps: number | null
  prescribedWeight: number | null
  /**
   * True when the set was prescribed something AND what was logged differs.
   *
   * Only then is the struck-through prescription drawn. Repeating the same
   * numbers twice on every row would bury the handful that actually moved.
   */
  diverged: boolean
}

/** One exercise as the SESSION recorded it — not as the plan describes it. */
export interface EditorLoggedExercise {
  /** 0-based position within the session. */
  position: number
  /** The session's own name for it; the plan may have been edited since. */
  name: string
  /** How this exercise's `weight` column reads. */
  loggingType: LoggingType
  sets: readonly EditorLoggedSet[]
}

/** The session a settled day already produced — facts, not plan. */
export interface EditorSession {
  /** Link to the workout itself; the log points at the real thing. */
  href: string
  completedSetCount: number
  setCount: number
  /** Total logged volume in the user's display unit, already converted. */
  volume: number
  /**
   * What was actually logged. Read from the SESSION rather than aligned to
   * today's plan: an exercise reordered or swapped since would otherwise put
   * one movement's numbers under another movement's name.
   */
  exercises: readonly EditorLoggedExercise[]
}

/** The addressed day, with everything the day pane renders. */
export interface EditorDayDetail extends EditorDay {
  exercises: readonly EditorExercise[]
  /** The settled day's session, or null when nothing has been logged. */
  session: EditorSession | null
}
