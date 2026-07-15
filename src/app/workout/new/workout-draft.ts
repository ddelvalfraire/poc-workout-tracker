import type { LoggingType, WorkoutInput } from '@/lib/workout-input'
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
}

/** An exercise in the draft, seeded with at least one empty set. */
export interface DraftExercise {
  /** Stable client id, used only for React keys — never persisted. */
  id: string
  wgerExerciseId: number
  name: string
  category: string
  /** How the weight fields read (Hevy-style); 'weight_reps' unless the user
   *  switches it. Required here (fully controlled), optional on the wire. */
  loggingType: LoggingType
  sets: DraftSet[]
}

export interface WorkoutDraft {
  exercises: DraftExercise[]
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
  /** Mount-time restore from the localStorage snapshot — replaces the whole draft. */
  | { type: 'RESTORE_DRAFT'; draft: WorkoutDraft }

export const emptyDraft: WorkoutDraft = { exercises: [] }

/**
 * Factories that mint stable client ids. Impure (id generation) and therefore
 * kept OUT of the reducer — callers create the object, the reducer just places
 * it, so the reducer stays pure and deterministic for unit tests.
 */
export function newDraftSet(): DraftSet {
  return { id: crypto.randomUUID(), reps: '', weight: '', completed: false }
}

/** Builds a draft exercise from a picked exercise, seeded with one empty set. */
export function newDraftExercise(picked: {
  wgerExerciseId: number
  name: string
  category: string
}): DraftExercise {
  return { id: crypto.randomUUID(), ...picked, loggingType: 'weight_reps', sets: [newDraftSet()] }
}

/**
 * Builds the swap replacement: the picked identity with the OLD slot's set
 * COUNT (the scheme survives) but fresh empty sets and the default
 * loggingType — typed values and a BW/assist reading belong to the old
 * movement (same meaning-change rule as SET_LOGGING_TYPE's weight clear).
 * Ghosts re-fill from the substitute's own history.
 */
export function replacementDraftExercise(
  picked: { wgerExerciseId: number; name: string; category: string },
  setCount: number,
): DraftExercise {
  return {
    id: crypto.randomUUID(),
    ...picked,
    loggingType: 'weight_reps',
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
      return { exercises: [...state.exercises, action.exercise] }

    case 'REMOVE_EXERCISE':
      return { exercises: state.exercises.filter((_, i) => i !== action.index) }

    case 'INSERT_EXERCISE': {
      const index = Math.min(action.index, state.exercises.length)
      return {
        exercises: [
          ...state.exercises.slice(0, index),
          action.exercise,
          ...state.exercises.slice(index),
        ],
      }
    }

    case 'REPLACE_EXERCISE': {
      if (action.index >= state.exercises.length) return state
      return { exercises: mapExerciseAt(state.exercises, action.index, () => action.exercise) }
    }

    case 'ADD_SET':
      return {
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          sets: [...exercise.sets, action.set],
        })),
      }

    case 'UPDATE_SET':
      return {
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set, i) =>
            i === action.setIndex ? { ...set, [action.field]: action.value } : set,
          ),
        })),
      }

    case 'SET_LOGGING_TYPE':
      return {
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
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
          ...exercise,
          sets: exercise.sets.filter((_, i) => i !== action.setIndex),
        })),
      }

    case 'INSERT_SET': {
      if (action.exerciseIndex >= state.exercises.length) return state
      return {
        exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => {
          const index = Math.min(action.setIndex, exercise.sets.length)
          return {
            ...exercise,
            sets: [...exercise.sets.slice(0, index), action.set, ...exercise.sets.slice(index)],
          }
        }),
      }
    }

    case 'TOGGLE_SET_COMPLETED':
      return {
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
  const exercises = draft.exercises.map((exercise) => ({
    wgerExerciseId: exercise.wgerExerciseId,
    name: exercise.name,
    loggingType: exercise.loggingType,
    sets: exercise.sets.map((set) => {
      const w = toWeight(set.weight)
      return {
        reps: toReps(set.reps),
        weight: w === null ? null : displayToKg(w, unit),
        // Omit when unchecked so the wire payload (and every MCP/save test
        // fixture that predates check-off) keeps its minimal shape.
        ...(set.completed && { completed: true }),
      }
    }),
  }))

  return trimmedName ? { name: trimmedName, exercises } : { exercises }
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
    name: exercise.name,
    category: '',
    loggingType: exercise.loggingType,
    sets: exercise.sets.map((set) => ({
      id: set.id,
      reps: set.reps?.toString() ?? '',
      weight: set.weight === null ? '' : kgToDisplay(set.weight, unit).toString(),
      completed: options.resetCompleted ? false : set.completed,
    })),
  }))
  return { draft: { exercises }, name: workout.name ?? '' }
}
