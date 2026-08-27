import type {
  EditorDay,
  EditorDayDetail,
  EditorExercise,
  EditorLoggedExercise,
  EditorSession,
  EditorSet,
  EditorWeek,
} from '@/components/editor/editor-model'
import type { LoggingType } from '@/lib/workout-input'
import type { SetType } from '@/lib/program-input'
import { kgToDisplay, type WeightUnit } from '@/lib/units'
import type { TrainedDayState } from './trained-view'

/**
 * Pure view logic for the program editor — the row-to-view-model mapping the
 * panes render, kept free of JSX so it unit-tests as plain functions (the
 * convention `./editor-address`, `../week-view` and `../derived-format` already
 * follow).
 *
 * Inputs are declared STRUCTURALLY rather than as the Drizzle-inferred
 * `ProgramDetail`: these functions need six columns out of a deeply nested
 * query result, and saying so lets the tests build a fixture in four lines
 * instead of standing up a whole program tree to assert a rep range.
 */

/** A per-week override row, as `programSetOverrides` stores it. */
export interface SourceOverride {
  week: number
  repMin: number | null
  repMax: number | null
  rir: number | null
  rpe: number | null
  suggestedLoadKg: number | null
}

/** A template set row plus its overrides, as `getProgramDetail` nests them. */
export interface SourceSet {
  setNumber: number
  setType: SetType
  repMin: number | null
  repMax: number | null
  rir: number | null
  rpe: number | null
  suggestedLoadKg: number | null
  overrides: readonly SourceOverride[]
}

export interface SourceExercise {
  name: string
  sets: readonly SourceSet[]
}

export interface SourceDay {
  name: string
  exercises: readonly SourceExercise[]
}

/**
 * The weeks the editor lists.
 *
 * `mesocycleWeeks` is NOT the outer bound, and treating it as one is the
 * documented way to lose real history: `updateProgramMeta` allows a shrink
 * below already-trained weeks and only REPORTS it (`trainedWeeksBeyond`), so
 * after a shrink the weeks the user actually trained sit above the block
 * length. A list that looped `1..mesocycleWeeks` would silently drop them.
 *
 * So the list is the union of the planned block and every week that carries a
 * workout, ascending. Weeks past the block are flagged rather than hidden —
 * they are facts, and the row can say why it is there.
 */
export function editorWeeks(
  mesocycleWeeks: number,
  deloadWeek: number | null,
  weeksWithWorkouts: readonly number[],
): EditorWeek[] {
  const planned = Math.max(1, mesocycleWeeks)
  const weeks = new Set<number>()
  for (let week = 1; week <= planned; week += 1) weeks.add(week)
  for (const week of weeksWithWorkouts) {
    if (Number.isSafeInteger(week) && week >= 1) weeks.add(week)
  }
  return [...weeks]
    .sort((a, b) => a - b)
    .map((week) => ({
      week,
      isDeload: week === deloadWeek,
      isBeyondBlock: week > planned,
    }))
}

/**
 * The structure pane's day rows — position is the address's path segment.
 *
 * `trainedStates` is positional and parallel to `days` because that is how the
 * caller already has it (one `resolveDayState` per day for the selected week).
 * A day with no entry reads as untouched rather than throwing: a shorter array
 * is a caller bug, and inventing "trained" from a missing value is the worse of
 * the two failures.
 */
export function editorDays(
  days: readonly SourceDay[],
  trainedStates: readonly TrainedDayState[],
): EditorDay[] {
  return days.map((day, position) => ({
    position,
    name: day.name,
    exerciseCount: day.exercises.length,
    trained: trainedStates[position] ?? null,
  }))
}

/**
 * One set as the selected week sees it: the template values with that week's
 * override laid over them, field by field.
 *
 * Per-field, not row-wise, because that is what `setProgramSetOverride` stores
 * — an override naming only `repMax` leaves the load alone, and collapsing the
 * two would invent a null the user never wrote. `overridden` is true only when
 * the week's row actually supplies a value, so an emptied override (every field
 * cleared) stops claiming to change anything.
 */
export function editorSetForWeek(set: SourceSet, week: number, unit: WeightUnit): EditorSet {
  const override = set.overrides.find((row) => row.week === week)
  const pick = <K extends 'repMin' | 'repMax' | 'rir' | 'rpe' | 'suggestedLoadKg'>(
    field: K,
  ): number | null => override?.[field] ?? set[field]

  const loadKg = pick('suggestedLoadKg')
  return {
    setNumber: set.setNumber,
    setType: set.setType,
    load: loadKg === null ? null : kgToDisplay(loadKg, unit),
    repMin: pick('repMin'),
    repMax: pick('repMax'),
    rir: pick('rir'),
    rpe: pick('rpe'),
    overridden:
      override !== undefined &&
      (override.repMin !== null ||
        override.repMax !== null ||
        override.rir !== null ||
        override.rpe !== null ||
        override.suggestedLoadKg !== null),
  }
}

/**
 * The kg load a set carries in one week — the same per-field override rule
 * `editorSetForWeek` applies, exported because the inspector's progression
 * sentence needs the anchor load in KG (it quantizes for display itself) and a
 * second copy of the rule is how the pane and the sentence start disagreeing
 * about what week 3 weighs.
 */
export function editorSetLoadKg(set: SourceSet, week: number): number | null {
  return set.overrides.find((row) => row.week === week)?.suggestedLoadKg ?? set.suggestedLoadKg
}

/** A logged set row, as the `sets` table stores it. */
export interface SourceLoggedSet {
  setNumber: number
  completed: boolean
  reps: number | null
  weight: number | null
  metricMode: string
  durationSec: number | null
  distanceM: number | null
  prescribedLoadKg: number | null
  prescribedRepMin: number | null
}

/** A logged exercise row, as `workoutExercises` stores it. */
export interface SourceLoggedExercise {
  name: string
  loggingType: LoggingType
  sets: readonly SourceLoggedSet[]
}

/**
 * What a settled session actually recorded.
 *
 * Read from the SESSION, never aligned to today's plan. The two can disagree —
 * an exercise reordered or swapped since the session started — and aligning by
 * position would put one movement's numbers under another movement's name. The
 * session carries its own names, so it is asked directly.
 *
 * `diverged` is the whole reason both halves are kept. A set that went exactly
 * as prescribed says so by showing ONE number; drawing the struck-through
 * target on every row would bury the handful that actually moved. And a set
 * with no prescription at all — an ad-hoc set, or anything logged before the
 * snapshot columns existed — never claims one: null is not a target of zero.
 */
export function editorLoggedExercises(
  exercises: readonly SourceLoggedExercise[],
): EditorLoggedExercise[] {
  return exercises.map((exercise, position) => ({
    position,
    name: exercise.name,
    loggingType: exercise.loggingType,
    sets: exercise.sets.map((set) => ({
      setNumber: set.setNumber,
      completed: set.completed,
      reps: set.reps,
      weight: set.weight,
      metricMode: set.metricMode as EditorLoggedExercise['sets'][number]['metricMode'],
      durationSec: set.durationSec,
      distanceM: set.distanceM,
      prescribedReps: set.prescribedRepMin,
      prescribedWeight: set.prescribedLoadKg,
      diverged:
        (set.prescribedRepMin !== null || set.prescribedLoadKg !== null) &&
        (set.prescribedRepMin !== set.reps || set.prescribedLoadKg !== set.weight),
    })),
  }))
}

/** One exercise's sets, resolved for the selected week. */
export function editorExercise(
  exercise: SourceExercise,
  position: number,
  week: number,
  unit: WeightUnit,
): EditorExercise {
  return {
    position,
    name: exercise.name,
    sets: exercise.sets.map((set) => editorSetForWeek(set, week, unit)),
  }
}

/**
 * The addressed day, resolved for the selected week. Null in, null out: the
 * address deliberately resolves an out-of-range day segment to "no day", and
 * this keeps that answer intact rather than substituting a neighbour.
 */
export function editorDayDetail(
  day: SourceDay | null,
  position: number | null,
  week: number,
  unit: WeightUnit,
  trained: TrainedDayState = null,
  session: EditorSession | null = null,
): EditorDayDetail | null {
  if (day === null || position === null) return null
  return {
    position,
    name: day.name,
    exerciseCount: day.exercises.length,
    trained,
    session,
    exercises: day.exercises.map((exercise, index) => editorExercise(exercise, index, week, unit)),
  }
}
