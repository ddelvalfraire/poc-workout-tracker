import { kgToDisplay, type WeightUnit } from '@/lib/units'
import type { SourceExercise, SourceSet } from './editor-view'

/**
 * Pure view logic for the editor's EXERCISE-WISE reading of a block — the
 * pivot. Same convention as `./editor-view`: no JSX, so it unit-tests as plain
 * functions, and no copy, so every string stays in the component's catalog.
 *
 * The day-wise reading answers "what am I doing on Thursday". This one answers
 * the question a week-at-a-time surface cannot: does this movement actually
 * climb across the block, and where did I step in and change it by hand. That
 * is a comparison DOWN a column and ACROSS a row, so the shape is a grid — one
 * row per exercise, one column per week.
 *
 * WHAT A CELL MAY CLAIM. A cell summarises a whole exercise's sets for one
 * week, and real sets are not uniform: a warmup, two working sets and an AMRAP
 * is an ordinary row, and rendering that as "4×8 @ 80" would state a
 * prescription nobody wrote. So:
 *
 *  - Warmups are excluded from the summary. They are ramp, not prescription,
 *    and counting them would drag every load in the grid toward the empty bar.
 *  - When the remaining sets agree, the cell states their numbers.
 *  - When they DISAGREE, the cell says so in its shape rather than picking a
 *    winner: `repsUniform` false means "print the count, not a rep target", and
 *    a load spread comes back as a low/high pair instead of one number.
 *
 * `pinned` is per (exercise × week) rather than per set, because that is the
 * grain the grid can show — one cell, one mark — and it is exactly what the
 * mark claims: this week has something you wrote by hand in it.
 */

/** One exercise's prescription for one week, as the grid renders it. */
export interface PivotCell {
  /** 1-based. */
  week: number
  /** How many non-warmup sets the week prescribes. */
  setCount: number
  /**
   * The shared rep target, when every counted set agrees. Both null either
   * when the sets disagree (`repsUniform` false) or when none names reps.
   */
  repMin: number | null
  repMax: number | null
  /** False when the counted sets prescribe different reps — print the count. */
  repsUniform: boolean
  /**
   * The load in the user's DISPLAY unit. Equal when every counted set agrees,
   * a spread otherwise. Both null when nothing in the week names a load.
   */
  loadLow: number | null
  loadHigh: number | null
  /** True when a per-week override supplies any value here — pinned by hand. */
  pinned: boolean
}

/** One movement's row across the block. */
export interface PivotRow {
  /** 0-based position — what the address's `?exercise=` carries. */
  position: number
  name: string
  cells: readonly PivotCell[]
}

/**
 * A set's values for one week: the template with that week's override laid over
 * it, field by field.
 *
 * The same per-field rule `editorSetForWeek` applies, restated over KG rather
 * than display units because the grid has to COMPARE loads before converting
 * them. Converting first would let a rounding step decide whether two weeks
 * agree, and a spread of one display decimal is not a spread.
 */
function resolveKg(set: SourceSet, week: number) {
  const override = set.overrides.find((row) => row.week === week)
  return {
    repMin: override?.repMin ?? set.repMin,
    repMax: override?.repMax ?? set.repMax,
    loadKg: override?.suggestedLoadKg ?? set.suggestedLoadKg,
    pinned:
      override !== undefined &&
      (override.repMin !== null ||
        override.repMax !== null ||
        override.rir !== null ||
        override.rpe !== null ||
        override.suggestedLoadKg !== null),
  }
}

/**
 * One cell: an exercise's counted sets for one week, collapsed.
 *
 * An exercise with nothing but warmups produces a zero-count cell rather than
 * vanishing from the grid — the movement is still in the block, and a hole
 * would read as "no data" when the truth is "no working sets".
 */
export function pivotCell(exercise: SourceExercise, week: number, unit: WeightUnit): PivotCell {
  // Pinning is asked of EVERY set, warmups included: a hand-written warmup is
  // still a hand-written week, and the mark would otherwise disappear on the
  // one row where it was the only edit.
  const pinned = exercise.sets.some((set) => resolveKg(set, week).pinned)

  const counted = exercise.sets
    .filter((set) => set.setType !== 'warmup')
    .map((set) => resolveKg(set, week))

  if (counted.length === 0) {
    return {
      week,
      setCount: 0,
      repMin: null,
      repMax: null,
      repsUniform: true,
      loadLow: null,
      loadHigh: null,
      pinned,
    }
  }

  const first = counted[0]
  const repsUniform = counted.every(
    (set) => set.repMin === first.repMin && set.repMax === first.repMax,
  )

  const loads = counted
    .map((set) => set.loadKg)
    .filter((load): load is number => load !== null)
    .sort((a, b) => a - b)

  return {
    week,
    setCount: counted.length,
    repMin: repsUniform ? first.repMin : null,
    repMax: repsUniform ? first.repMax : null,
    repsUniform,
    loadLow: loads.length === 0 ? null : kgToDisplay(loads[0], unit),
    loadHigh: loads.length === 0 ? null : kgToDisplay(loads[loads.length - 1], unit),
    pinned,
  }
}

/**
 * The whole grid: every exercise of the addressed day, across every week the
 * caller lists.
 *
 * Weeks arrive from `editorWeeks` rather than being generated here from
 * `mesocycleWeeks`, so the pivot inherits that module's one non-obvious rule
 * for free: a block shrunk below its trained weeks still lists them, because
 * they are real sessions and looping `1..mesocycleWeeks` is the documented way
 * to make them disappear.
 */
export function pivotRows(
  exercises: readonly SourceExercise[],
  weeks: readonly number[],
  unit: WeightUnit,
): PivotRow[] {
  return exercises.map((exercise, position) => ({
    position,
    name: exercise.name,
    cells: weeks.map((week) => pivotCell(exercise, week, unit)),
  }))
}
