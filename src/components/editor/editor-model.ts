import type { SetType } from '@/lib/program-input'

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
}

/** The addressed day, with everything the day pane renders. */
export interface EditorDayDetail extends EditorDay {
  exercises: readonly EditorExercise[]
}
