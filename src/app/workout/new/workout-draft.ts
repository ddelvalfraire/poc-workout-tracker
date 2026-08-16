import type {
  LoggingType,
  WorkoutInput,
  WorkoutMetricMode,
  WorkoutSetType,
} from '@/lib/workout-input'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import type { WorkoutDetail } from '@/db/workouts'
import { displayToKg, kgToDisplay, type WeightUnit } from '@/lib/units'
import { defaultMetricModeForCategory, isMetricMode } from '@/lib/workout-input'
export { defaultMetricModeForCategory }
import { isValidRir, isValidRpe } from '@/lib/effort'
import {
  formatDistanceInput,
  formatDurationInput,
  parseDistanceInput,
  parseDurationInput,
} from '@/lib/duration'

/**
 * Pure client-state logic for the in-progress workout, kept free of React/JSX so
 * the reducer and mapper unit-test as plain functions (mirroring how the repo
 * tests `wger.ts`/`workouts.ts`). The logger component wires this to `useReducer`.
 *
 * Draft set fields are STRINGS because they back controlled `<input>`s; the
 * server-bound shape (numbers/null) is produced once, at save time, by
 * `draftToInput`. Every reducer case returns fresh objects/arrays — no mutation.
 */

/** A set as edited in the UI: raw string fields from controlled inputs. */
export interface DraftSet {
  /** Stable client id, used only for React keys — never persisted. */
  id: string
  reps: string
  weight: string
  /** In-session check-off state; required here (fully controlled), optional on the wire. */
  completed: boolean
  /** Warm-up tag; required here (fully controlled), optional on the wire
   *  ('working' default) — same treatment as completed. */
  tag: WorkoutSetType
  /** Logged effort, chip-selected ('' / absent = not logged). OPTIONAL —
   *  unlike completed/tag — so pre-effort drafts, payloads, and fixtures stay
   *  valid without a codec version bump; readers treat absent as ''. */
  rir?: string
  rpe?: string
  /** How this set is measured. OPTIONAL — absent = 'reps_weight' — so every
   *  pre-cardio draft, payload, and fixture stays valid without a codec
   *  version bump (the rir/rpe precedent). */
  metricMode?: WorkoutMetricMode
  /** Cardio duration as typed ("12:30" / bare minutes — lib/duration.ts);
   *  optional like metricMode, absent reads as ''. */
  duration?: string
  /** Cardio distance in km as typed; optional, absent reads as ''. */
  distance?: string
}

/** Ghost values a tap can adopt into EMPTY fields (FILL_SET / check-off). */
export interface SetFill {
  reps?: string
  weight?: string
  duration?: string
  distance?: string
}

/** An exercise in the draft, seeded with at least one empty set. */
export interface DraftExercise {
  /** Stable client id, used only for React keys — never persisted. */
  id: string
  wgerExerciseId: number
  /** Exercise identity is the composite (source, id) — a custom exercise's
   *  id can collide with a wger id. Required here (fully controlled),
   *  optional on the wire ('wger' default), same treatment as loggingType. */
  source: ExerciseSource
  name: string
  category: string
  /** How the weight fields read (Hevy-style); 'weight_reps' unless the user
   *  switches it. Required here (fully controlled), optional on the wire. */
  loggingType: LoggingType
  /** Free-form per-exercise note; '' = none. Required here (controlled
   *  textarea), optional on the wire — same treatment as loggingType. */
  notes: string
  /** Skipped in-session. Skipping never completes or deletes the sets — they
   *  stay uncompleted (completed-only counting keeps them out of stats). */
  skipped: boolean
  sets: DraftSet[]
}

export interface WorkoutDraft {
  exercises: DraftExercise[]
  /** Free-form session note; '' = none (controlled textarea). */
  notes: string
}

export type DraftAction =
  | { type: 'ADD_EXERCISE'; exercise: DraftExercise }
  | { type: 'REMOVE_EXERCISE'; index: number }
  /** Undo for REMOVE_EXERCISE: re-inserts at the original numeric position
   *  (clamped to the current length). If the list changed meanwhile the
   *  exercise may land at a shifted spot — accepted tradeoff: order is
   *  cosmetic here, the sets themselves are what the undo protects. */
  | { type: 'INSERT_EXERCISE'; index: number; exercise: DraftExercise }
  /** Swaps the exercise at `index` for a replacement built by the caller
   *  (replacementDraftExercise) — the machine-is-taken swap. Verbatim
   *  placement like ADD_EXERCISE; a stale index past the end is a no-op. */
  | { type: 'REPLACE_EXERCISE'; index: number; exercise: DraftExercise }
  | { type: 'ADD_SET'; exerciseIndex: number; set: DraftSet }
  | {
      type: 'UPDATE_SET'
      exerciseIndex: number
      setIndex: number
      field: 'reps' | 'weight' | 'duration' | 'distance'
      value: string
    }
  | { type: 'REMOVE_SET'; exerciseIndex: number; setIndex: number }
  /** Retags one set (working ↔ warmup) — the long-press toggle. Values and
   *  completion survive: the tag changes how the set SCORES, not what it says. */
  | { type: 'TAG_SET'; exerciseIndex: number; setIndex: number; tag: WorkoutSetType }
  /** Post-completion effort chips: set/clear rir and/or rpe on one set. A
   *  provided field replaces ('' clears); an omitted field is untouched. */
  | { type: 'SET_EFFORT'; exerciseIndex: number; setIndex: number; rir?: string; rpe?: string }
  /** The Previous-chip tap: adopt ghost values into EMPTY fields only, without
   *  touching completion — same fill semantics as TOGGLE_SET_COMPLETED minus
   *  the check. Typed input always wins over the chip. */
  | {
      type: 'FILL_SET'
      exerciseIndex: number
      setIndex: number
      fill: SetFill
    }
  /** Switches how an exercise's weights read (BW / +weight / −assist). Values
   *  already typed are left alone — they re-read under the new type. */
  | { type: 'SET_LOGGING_TYPE'; exerciseIndex: number; loggingType: LoggingType }
  /** Undo for REMOVE_SET: re-inserts at the original position (clamped). A
   *  no-op when the exercise itself is gone — there's nothing to restore into. */
  | { type: 'INSERT_SET'; exerciseIndex: number; setIndex: number; set: DraftSet }
  /** `fill` (tap-to-accept ghost values) applies only to EMPTY fields, and only
   *  when checking off — never on uncheck, never over typed input. */
  | {
      type: 'TOGGLE_SET_COMPLETED'
      exerciseIndex: number
      setIndex: number
      fill?: SetFill
    }
  /** Controlled workout-level notes textarea. */
  | { type: 'SET_WORKOUT_NOTES'; value: string }
  /** Controlled per-exercise notes textarea. */
  | { type: 'SET_EXERCISE_NOTES'; exerciseIndex: number; value: string }
  /** Flips an exercise's skipped flag. Sets are untouched either way —
   *  skipping records "didn't do this", it never rewrites what WAS done. */
  | { type: 'TOGGLE_SKIP_EXERCISE'; exerciseIndex: number }
  /** Mount-time restore from the localStorage snapshot — replaces the whole draft. */
  | { type: 'RESTORE_DRAFT'; draft: WorkoutDraft }

export const emptyDraft: WorkoutDraft = { exercises: [], notes: '' }

/**
 * Factories that mint stable client ids. Impure (id generation) and therefore
 * kept OUT of the reducer — callers create the object, the reducer just places
 * it, so the reducer stays pure and deterministic for unit tests.
 */
export function newDraftSet(metricMode?: WorkoutMetricMode): DraftSet {
  return {
    id: crypto.randomUUID(),
    reps: '',
    weight: '',
    completed: false,
    tag: 'working',
    // Only non-default modes are stamped — reps_weight stays ABSENT so the
    // minimal wire/payload shape (and every pre-cardio fixture) is preserved.
    ...(metricMode !== undefined && metricMode !== 'reps_weight' && { metricMode }),
  }
}

/** A set's effective metric mode (absent = the reps_weight column default). */
export function setMetricMode(set: Pick<DraftSet, 'metricMode'>): WorkoutMetricMode {
  return set.metricMode ?? 'reps_weight'
}

/** The mode NEW sets of this exercise should adopt: the last set's mode (the
 *  scheme being extended), falling back to the category default. */
export function nextSetMetricMode(exercise: DraftExercise): WorkoutMetricMode {
  const last = exercise.sets[exercise.sets.length - 1]
  return last !== undefined ? setMetricMode(last) : defaultMetricModeForCategory(exercise.category)
}

/** Builds a draft exercise from a picked exercise, seeded with one empty set.
 *  `source` defaults to 'wger' — the picker only offers catalog entries until
 *  the merged-catalog phase labels its results. A Cardio-category pick seeds
 *  its set in duration_distance mode. */
export function newDraftExercise(picked: {
  wgerExerciseId: number
  source?: ExerciseSource
  name: string
  category: string
}): DraftExercise {
  return {
    ...picked,
    // AFTER the spread (defense-in-depth): a smuggled `id` riding a hostile
    // pick object must never beat the fresh uuid.
    id: crypto.randomUUID(),
    source: picked.source ?? 'wger',
    loggingType: 'weight_reps',
    notes: '',
    skipped: false,
    sets: [newDraftSet(defaultMetricModeForCategory(picked.category))],
  }
}

/**
 * Builds the swap replacement: the picked identity with the OLD slot's set
 * COUNT (the scheme survives) but fresh empty sets and the default
 * loggingType — typed values and a BW/assist reading belong to the old
 * movement (same meaning-change rule as SET_LOGGING_TYPE's weight clear).
 * Ghosts re-fill from the substitute's own history.
 */
export function replacementDraftExercise(
  picked: { wgerExerciseId: number; source?: ExerciseSource; name: string; category: string },
  setCount: number,
): DraftExercise {
  return {
    ...picked,
    // AFTER the spread (defense-in-depth) — same rule as newDraftExercise.
    id: crypto.randomUUID(),
    source: picked.source ?? 'wger',
    loggingType: 'weight_reps',
    // Fresh note and skip state: both belonged to the old movement.
    notes: '',
    skipped: false,
    // Metric mode follows the SUBSTITUTE's category, not the old slot's —
    // swapping squats for cycling changes what a set even measures.
    sets: Array.from({ length: Math.max(1, setCount) }, () =>
      newDraftSet(defaultMetricModeForCategory(picked.category)),
    ),
  }
}

/** Replaces the exercise at `index` via `update`, returning a new exercises array. */
function mapExerciseAt(
  exercises: DraftExercise[],
  index: number,
  update: (exercise: DraftExercise) => DraftExercise,
): DraftExercise[] {
  return exercises.map((exercise, i) => (i === index ? update(exercise) : exercise))
}

export function workoutDraftReducer(state: WorkoutDraft, action: DraftAction): WorkoutDraft {
  switch (action.type) {
    case 'ADD_EXERCISE':
      return { ...state, exercises: [...state.exercises, action.exercise] }

    case 'REMOVE_EXERCISE':
      return { ...state, exercises: state.exercises.filter((_, i) => i !== action.index) }

    case 'INSERT_EXERCISE': {
      const index = Math.min(action.index, state.exercises.length)
      return {
        ...state,
        exercises: [
          ...state.exercises.slice(0, index),
          action.exercise,
          ...state.exercises.slice(index),
        ],
      }
    }

    case 'REPLACE_EXERCISE': {
      if (action.index >= state.exercises.length) return state
      return { ...state, exercises: mapExerciseAt(state.exercises, action.index, () => action.exercise) }
    }

    case 'ADD_SET':
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          sets: [...exercise.sets, action.set],
        })),
      }

    case 'UPDATE_SET':
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set, i) =>
            i === action.setIndex ? { ...set, [action.field]: action.value } : set,
          ),
        })),
      }

    case 'TAG_SET':
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set, i) =>
            i === action.setIndex ? { ...set, tag: action.tag } : set,
          ),
        })),
      }

    case 'SET_EFFORT':
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set, i) =>
            i === action.setIndex
              ? {
                  ...set,
                  ...(action.rir !== undefined ? { rir: action.rir } : {}),
                  ...(action.rpe !== undefined ? { rpe: action.rpe } : {}),
                }
              : set,
          ),
        })),
      }

    case 'SET_LOGGING_TYPE':
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          loggingType: action.loggingType,
          // Clear typed weights: the column's MEANING changes with the type
          // (total load vs added vs assistance), so a value entered under the
          // old type would be silently re-read as something else — an
          // inflated e1RM and a phantom PR. Reps and completion survive.
          sets: exercise.sets.map((set) => ({ ...set, weight: '' })),
        })),
      }

    case 'REMOVE_SET':
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          sets: exercise.sets.filter((_, i) => i !== action.setIndex),
        })),
      }

    case 'INSERT_SET': {
      if (action.exerciseIndex >= state.exercises.length) return state
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => {
          const index = Math.min(action.setIndex, exercise.sets.length)
          return {
            ...exercise,
            sets: [...exercise.sets.slice(0, index), action.set, ...exercise.sets.slice(index)],
          }
        }),
      }
    }

    case 'FILL_SET':
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set, i) =>
            i === action.setIndex ? adoptFill(set, action.fill) : set,
          ),
        })),
      }

    case 'TOGGLE_SET_COMPLETED':
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => {
          // Checking off a weight_reps set with no usable weight (typed or
          // adoptable from the fill) is refused whole — no completion, no
          // partial fill. A "done" set with a phantom load poisons volume
          // and e1RM downstream. Unchecking is always allowed, so legacy
          // rows that predate this rule stay correctable.
          const target = exercise.sets[action.setIndex]
          if (
            target &&
            !target.completed &&
            isMissingRequiredMetric(exercise, action.setIndex, action.fill)
          ) {
            return exercise
          }
          return {
            ...exercise,
            sets: exercise.sets.map((set, i) => {
              if (i !== action.setIndex) return set
              const checkingOff = !set.completed
              const fill = checkingOff ? action.fill : undefined
              return { ...(fill ? adoptFill(set, fill) : set), completed: checkingOff }
            }),
          }
        }),
      }

    case 'SET_WORKOUT_NOTES':
      return { ...state, notes: action.value }

    case 'SET_EXERCISE_NOTES':
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          notes: action.value,
        })),
      }

    case 'TOGGLE_SKIP_EXERCISE':
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          skipped: !exercise.skipped,
        })),
      }

    case 'RESTORE_DRAFT':
      return action.draft

    default:
      return state
  }
}

/** Adopts fill values into EMPTY fields only — typed input always wins.
 *  Shared by FILL_SET (the Prev chip) and TOGGLE_SET_COMPLETED (tap-to-accept)
 *  so the two fills can never drift. Absent cardio strings count as empty. */
function adoptFill(set: DraftSet, fill: SetFill): DraftSet {
  return {
    ...set,
    reps: set.reps === '' && fill.reps ? fill.reps : set.reps,
    weight: set.weight === '' && fill.weight ? fill.weight : set.weight,
    ...(fill.duration && !(set.duration ?? '') ? { duration: fill.duration } : {}),
    ...(fill.distance && !(set.distance ?? '') ? { distance: fill.distance } : {}),
  }
}

/** Parses a reps string to a non-negative integer, or null when blank/invalid. */
function toReps(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = parseInt(trimmed, 10)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** Parses a chip-set RIR string to a valid integer, or null when blank/off-grid.
 *  Stricter than toReps: only grid values may reach the wire — the server
 *  rejects off-grid effort, and a corrupt draft must not fail the save. */
function toRir(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return null
  const n = Number(trimmed)
  return isValidRir(n) ? n : null
}

/** Parses a chip-set RPE string to a valid half-step value, or null. */
function toRpe(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return null
  const n = Number(trimmed)
  return isValidRpe(n) ? n : null
}

/** Parses a weight string to a non-negative number, or null when blank/invalid. */
function toWeight(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = parseFloat(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Maps the string-based draft to the server contract. Lenient by design — the
 * Server Action re-validates via `parseWorkoutInput`; here `''` → `null` and
 * numeric strings become numbers. Weights are entered in `unit` (default kg) and
 * converted to canonical kg here. A blank workout name is dropped.
 */
export function draftToInput(
  draft: WorkoutDraft,
  name?: string,
  unit: WeightUnit = 'kg',
): WorkoutInput {
  const trimmedName = name?.trim()
  const trimmedNotes = draft.notes.trim()
  const exercises = draft.exercises.map((exercise) => {
    const exerciseNotes = exercise.notes.trim()
    return {
      wgerExerciseId: exercise.wgerExerciseId,
      source: exercise.source,
      name: exercise.name,
      loggingType: exercise.loggingType,
      // Empty notes → omitted (the column stores null); skipped only when true
      // — same minimal wire shape as completed/setType below.
      ...(exerciseNotes !== '' && { notes: exerciseNotes }),
      ...(exercise.skipped && { skipped: true }),
      sets: exercise.sets.map((set) => {
        const w = toWeight(set.weight)
        const rir = toRir(set.rir)
        const rpe = toRpe(set.rpe)
        const metricMode = setMetricMode(set)
        // Cardio sets speak duration/distance INSTEAD of reps/weight — a
        // stray typed rep on a timed set must not leak into scoring.
        if (metricMode !== 'reps_weight') {
          return {
            reps: null,
            weight: null,
            metricMode,
            durationSec: parseDurationInput(set.duration ?? ''),
            distanceM:
              metricMode === 'duration_distance' ? parseDistanceInput(set.distance ?? '') : null,
            ...(set.completed && { completed: true }),
            ...(set.tag === 'warmup' && { setType: 'warmup' as const }),
            ...(rir !== null && { rir }),
            ...(rpe !== null && { rpe }),
          }
        }
        return {
          reps: toReps(set.reps),
          weight: w === null ? null : displayToKg(w, unit),
          // Omit when unchecked so the wire payload (and every MCP/save test
          // fixture that predates check-off) keeps its minimal shape.
          ...(set.completed && { completed: true }),
          // Same minimal-shape rule: 'working' is the column default.
          ...(set.tag === 'warmup' && { setType: 'warmup' as const }),
          // Effort only when logged and on-grid (null column default otherwise).
          ...(rir !== null && { rir }),
          ...(rpe !== null && { rpe }),
        }
      }),
    }
  })

  return {
    ...(trimmedName && { name: trimmedName }),
    ...(trimmedNotes !== '' && { notes: trimmedNotes }),
    exercises,
  }
}

/**
 * Seeds an editable draft from a persisted workout (the inverse of
 * draftToInput). Numbers become input strings (`null` → `''`); the persisted
 * row UUIDs are reused as the draft's client ids (stable React keys). `category`
 * is not a persisted column, so it comes back empty. Stored kg weights are
 * converted to `unit` (default kg) for display. Pure (no `crypto`), so the edit
 * Server Component can call it safely.
 *
 * `resetCompleted` clears the check-off state — the repeat flow (`?from=`)
 * seeds a NEW session from an old workout, and yesterday's checks aren't
 * today's; edit mode keeps them (default).
 */
export function detailToDraft(
  workout: WorkoutDetail,
  unit: WeightUnit = 'kg',
  options: { resetCompleted?: boolean } = {},
): { draft: WorkoutDraft; name: string } {
  const exercises = workout.exercises.map((exercise) => ({
    id: exercise.id,
    wgerExerciseId: exercise.wgerExerciseId,
    source: exercise.source,
    name: exercise.name,
    category: '',
    loggingType: exercise.loggingType,
    notes: exercise.notes ?? '',
    skipped: exercise.skipped,
    sets: exercise.sets.map((set) => ({
      id: set.id,
      reps: set.reps?.toString() ?? '',
      weight: set.weight === null ? '' : kgToDisplay(set.weight, unit).toString(),
      completed: options.resetCompleted ? false : set.completed,
      // The draft UI only speaks working/warmup; backoff/amrap render as
      // working here and their true type survives the save via
      // updateWorkout's prior-facts preservation (never through the wire).
      tag: set.setType === 'warmup' ? ('warmup' as const) : ('working' as const),
      // Logged effort round-trips as strings (edit mode must not shed it).
      rir: set.rir?.toString() ?? '',
      rpe: set.rpe?.toString() ?? '',
      // Cardio metric round-trip: non-default modes carry their fields as
      // input strings; reps_weight rows stay shape-identical (fields absent).
      // isMetricMode guards the un-$typed DB text — junk degrades to default.
      ...(isMetricMode(set.metricMode) && set.metricMode !== 'reps_weight'
        ? {
            metricMode: set.metricMode,
            duration: set.durationSec !== null ? formatDurationInput(set.durationSec) : '',
            distance: set.distanceM !== null ? formatDistanceInput(set.distanceM) : '',
          }
        : {}),
    })),
  }))
  return { draft: { exercises, notes: workout.notes ?? '' }, name: workout.name ?? '' }
}

/**
 * True when marking this set done must be refused: weight_reps mode with no
 * usable weight typed and none adoptable from `fill`. Bodyweight modes are
 * exempt — a blank weight is their normal reading (BW / +0 added / no
 * assist). An explicit "0" passes (empty-bar work is a real load). Shared by
 * the reducer guard, the finish pass, and the logger's pre-dispatch check so
 * all three refuse the same sets.
 */
export function isMissingRequiredWeight(
  exercise: DraftExercise,
  setIndex: number,
  fill?: SetFill,
): boolean {
  if (exercise.loggingType !== 'weight_reps') return false
  const set = exercise.sets[setIndex]
  if (!set) return false
  // Cardio sets have no weight to require — their gate is duration, below.
  if (setMetricMode(set) !== 'reps_weight') return false
  const effective = set.weight.trim() === '' && fill?.weight ? fill.weight : set.weight
  return toWeight(effective) === null
}

/**
 * The metric-aware completion gate (supersedes calling isMissingRequiredWeight
 * directly): a duration-mode set completes only with a duration > 0 — typed
 * or adoptable from `fill` — mirroring the #206 weight-required rule (a
 * "done" cardio set with no time is a phantom fact); reps_weight sets keep
 * the weight rule. Shared by the reducer guard, the finish pass, and the
 * logger's pre-dispatch check so all three refuse the same sets.
 */
export function isMissingRequiredMetric(
  exercise: DraftExercise,
  setIndex: number,
  fill?: SetFill,
): boolean {
  const set = exercise.sets[setIndex]
  if (!set) return false
  if (setMetricMode(set) !== 'reps_weight') {
    const typed = set.duration ?? ''
    const effective = typed.trim() === '' && fill?.duration ? fill.duration : typed
    return parseDurationInput(effective) === null
  }
  return isMissingRequiredWeight(exercise, setIndex, fill)
}

/** Plain positive-integer reps ("5", never "5.9"/"0"/"5e1") — the bar a set
 *  must clear to be auto-completed at finish. Stricter than toReps (which
 *  truncates fractions for persistence): auto-completion only claims sets
 *  whose "I did this" reading is unambiguous. */
const PERFORMED_REPS_PATTERN = /^\d+$/

function hasPerformedReps(reps: string): boolean {
  const trimmed = reps.trim()
  return PERFORMED_REPS_PATTERN.test(trimmed) && parseInt(trimmed, 10) >= 1
}

/**
 * The finish-time completion pass: every unchecked set with reps logged gets
 * checked off (typing the reps IS the "I did it" — forgetting the circle
 * must not erase the set from scoring), and whatever remains unchecked is
 * counted so the finish flow can warn before saving it as skipped. A
 * weight_reps set additionally needs a weight — auto-claiming one without it
 * would persist exactly the phantom-load row the reducer guard refuses.
 * Bodyweight modes still complete on reps alone. Pure: builds a fresh draft,
 * counts both outcomes, never mutates its input.
 */
export function completeFilledSets(draft: WorkoutDraft): {
  draft: WorkoutDraft
  /** Unchecked sets flipped to completed (reps present). */
  autoCompleted: number
  /** Unchecked sets left as-is (no usable reps) — the warning names these. */
  skipped: number
} {
  let autoCompleted = 0
  let skipped = 0
  const exercises = draft.exercises.map((exercise) => {
    // A skipped exercise opted out of the session: its sets stay uncompleted
    // by design, and warning about them would nag over a decision already made.
    if (exercise.skipped) return exercise
    return {
      ...exercise,
      sets: exercise.sets.map((set, setIndex) => {
        if (set.completed) return set
        // Cardio sets: a parseable duration IS the "I did it" (the analog of
        // typed reps); the metric gate above already requires duration > 0.
        const performed =
          setMetricMode(set) !== 'reps_weight'
            ? !isMissingRequiredMetric(exercise, setIndex)
            : hasPerformedReps(set.reps) && !isMissingRequiredWeight(exercise, setIndex)
        if (performed) {
          autoCompleted += 1
          return { ...set, completed: true }
        }
        skipped += 1
        return set
      }),
    }
  })
  return { draft: { ...draft, exercises }, autoCompleted, skipped }
}

/**
 * The set an out-of-band weight (the plate sheet's counted total) should land
 * on: the first incomplete set — the one being worked — else the last set
 * (everything checked = the lifter is correcting the top). −1 for no sets;
 * callers must no-op on that.
 */
export function resolveTargetSetIndex(sets: DraftSet[]): number {
  const firstIncomplete = sets.findIndex((set) => !set.completed)
  return firstIncomplete === -1 ? sets.length - 1 : firstIncomplete
}
