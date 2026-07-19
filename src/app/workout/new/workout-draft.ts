import type { LoggingType, WorkoutInput, WorkoutSetType } from '@/lib/workout-input'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import type { WorkoutDetail } from '@/db/workouts'
import { displayToKg, kgToDisplay, type WeightUnit } from '@/lib/units'

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
      field: 'reps' | 'weight'
      value: string
    }
  | { type: 'REMOVE_SET'; exerciseIndex: number; setIndex: number }
  /** Retags one set (working ↔ warmup) — the long-press toggle. Values and
   *  completion survive: the tag changes how the set SCORES, not what it says. */
  | { type: 'TAG_SET'; exerciseIndex: number; setIndex: number; tag: WorkoutSetType }
  /** The Previous-chip tap: adopt ghost values into EMPTY fields only, without
   *  touching completion — same fill semantics as TOGGLE_SET_COMPLETED minus
   *  the check. Typed input always wins over the chip. */
  | {
      type: 'FILL_SET'
      exerciseIndex: number
      setIndex: number
      fill: { reps?: string; weight?: string }
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
      fill?: { reps?: string; weight?: string }
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
export function newDraftSet(): DraftSet {
  return { id: crypto.randomUUID(), reps: '', weight: '', completed: false, tag: 'working' }
}

/** Builds a draft exercise from a picked exercise, seeded with one empty set.
 *  `source` defaults to 'wger' — the picker only offers catalog entries until
 *  the merged-catalog phase labels its results. */
export function newDraftExercise(picked: {
  wgerExerciseId: number
  source?: ExerciseSource
  name: string
  category: string
}): DraftExercise {
  return {
    id: crypto.randomUUID(),
    ...picked,
    source: picked.source ?? 'wger',
    loggingType: 'weight_reps',
    notes: '',
    skipped: false,
    sets: [newDraftSet()],
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
    id: crypto.randomUUID(),
    ...picked,
    source: picked.source ?? 'wger',
    loggingType: 'weight_reps',
    // Fresh note and skip state: both belonged to the old movement.
    notes: '',
    skipped: false,
    sets: Array.from({ length: Math.max(1, setCount) }, () => newDraftSet()),
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
            i === action.setIndex
              ? {
                  ...set,
                  reps: set.reps === '' && action.fill.reps ? action.fill.reps : set.reps,
                  weight: set.weight === '' && action.fill.weight ? action.fill.weight : set.weight,
                }
              : set,
          ),
        })),
      }

    case 'TOGGLE_SET_COMPLETED':
      return {
        ...state,
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set, i) => {
            if (i !== action.setIndex) return set
            const checkingOff = !set.completed
            const fill = checkingOff ? action.fill : undefined
            return {
              ...set,
              reps: set.reps === '' && fill?.reps ? fill.reps : set.reps,
              weight: set.weight === '' && fill?.weight ? fill.weight : set.weight,
              completed: checkingOff,
            }
          }),
        })),
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

/** Parses a reps string to a non-negative integer, or null when blank/invalid. */
function toReps(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = parseInt(trimmed, 10)
  return Number.isInteger(n) && n >= 0 ? n : null
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
        return {
          reps: toReps(set.reps),
          weight: w === null ? null : displayToKg(w, unit),
          // Omit when unchecked so the wire payload (and every MCP/save test
          // fixture that predates check-off) keeps its minimal shape.
          ...(set.completed && { completed: true }),
          // Same minimal-shape rule: 'working' is the column default.
          ...(set.tag === 'warmup' && { setType: 'warmup' as const }),
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
    })),
  }))
  return { draft: { exercises, notes: workout.notes ?? '' }, name: workout.name ?? '' }
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
 * counted so the finish flow can warn before saving it as skipped. Weight
 * stays irrelevant here — null-weight machine sets are legitimate, and
 * bodyweight sets never carry one. Pure: builds a fresh draft, counts both
 * outcomes, never mutates its input.
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
      sets: exercise.sets.map((set) => {
        if (set.completed) return set
        if (hasPerformedReps(set.reps)) {
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
