/**
 * Shared save contract between the client mapper (`draftToInput`), the Server
 * Action, and the DB layer (`saveWorkout`) — one source of truth for the shape
 * a workout is persisted in.
 *
 * `parseWorkoutInput` is the trust boundary for the write: it takes `unknown`
 * (whatever the client sends to the action) and either returns a fresh,
 * normalized `WorkoutInput` or throws. It mirrors the defensive, field-by-field
 * validation in `wger.ts` — nothing is coerced silently, and the input object is
 * never mutated.
 *
 * Hand-rolled rather than schema-based: this repo has no validation library yet.
 * The upgrade path is to replace the body of `parseWorkoutInput` with a Zod (or
 * similar) schema while keeping the same signature.
 */

/** A single logged set. `null` means the field was left blank. */
export interface SetInput {
  reps: number | null
  weight: number | null
}

/** One exercise within a workout, with its logged sets. */
export interface ExerciseInput {
  wgerExerciseId: number
  name: string
  sets: SetInput[]
}

/** A full workout ready to persist. */
export interface WorkoutInput {
  name?: string
  exercises: ExerciseInput[]
  /**
   * When the session was performed. Optional so create defaults to the DB's
   * `now()` and update preserves the existing value; set it to backdate a
   * logged session. Must not be in the future.
   */
  startedAt?: Date
  /**
   * When the session ended. Optional: the DB layer falls back to `startedAt`
   * (a backdated log completes at its own moment, not save time) and then to
   * now. Must not be in the future or before `startedAt`.
   */
  completedAt?: Date
}

const MAX_NAME = 200
// sets.weight is numeric(6,2) in the schema, so 9999.99 is the column ceiling.
// Bounding here turns an out-of-range value into a clear validation error
// instead of an opaque Postgres overflow inside the save transaction.
export const MAX_WEIGHT = 9999.99
// A generous sanity cap for the integer `reps` column — no real set exceeds it.
const MAX_REPS = 10_000

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error(message)
  return value as Record<string, unknown>
}

/** Validates an optional name: must be a string; blank/whitespace → omitted. */
function parseName(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw new Error('workout name must be a string')
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length > MAX_NAME) throw new Error(`workout name must be ${MAX_NAME} characters or fewer`)
  return trimmed
}

/**
 * Validates an optional past-or-present date field: accepts a `Date` or an
 * ISO/parseable date string and returns a `Date`; absent/blank → omitted.
 * Rejects an unparseable value and a future date (a session can't have
 * happened later than now).
 */
function parsePastDate(raw: unknown, field: string): Date | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string' && raw.trim().length === 0) return undefined
  if (!(raw instanceof Date) && typeof raw !== 'string') {
    throw new Error(`workout ${field} must be a date or ISO date string`)
  }
  const date = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(date.getTime())) throw new Error(`workout ${field} is not a valid date`)
  if (date.getTime() > Date.now()) throw new Error("workout date can't be in the future")
  return date
}

/** Validates an optional `startedAt` (see parsePastDate). */
export function parseStartedAt(raw: unknown): Date | undefined {
  return parsePastDate(raw, 'startedAt')
}

/** Validates a single set: reps a non-negative integer or null, weight a non-negative finite number or null. */
function parseSet(raw: unknown): SetInput {
  const obj = asRecord(raw, 'each set must be an object')

  const { reps } = obj
  if (
    reps !== null &&
    (!Number.isInteger(reps) || (reps as number) < 0 || (reps as number) > MAX_REPS)
  ) {
    throw new Error(`set reps must be an integer between 0 and ${MAX_REPS}, or null`)
  }

  const { weight } = obj
  if (
    weight !== null &&
    (!Number.isFinite(weight) || (weight as number) < 0 || (weight as number) > MAX_WEIGHT)
  ) {
    // Weights are validated in canonical kg (entered lb is converted before this
    // boundary), so the bound is stated in kg to avoid a misleading lb message.
    throw new Error(`set weight must be a number between 0 and ${MAX_WEIGHT} kg, or null`)
  }

  return { reps: reps as number | null, weight: weight as number | null }
}

/** Validates a single exercise and its sets. */
function parseExercise(raw: unknown): ExerciseInput {
  const obj = asRecord(raw, 'each exercise must be an object')

  const { wgerExerciseId } = obj
  if (!Number.isInteger(wgerExerciseId)) {
    throw new Error('exercise wgerExerciseId must be an integer')
  }

  const { name } = obj
  if (typeof name !== 'string') throw new Error('exercise name must be a string')
  const trimmedName = name.trim()
  if (trimmedName.length === 0) throw new Error('exercise name must not be empty')
  if (trimmedName.length > MAX_NAME) throw new Error(`exercise name must be ${MAX_NAME} characters or fewer`)

  if (!Array.isArray(obj.sets)) throw new Error('exercise sets must be an array')
  const sets = obj.sets.map(parseSet)

  return { wgerExerciseId: wgerExerciseId as number, name: trimmedName, sets }
}

/**
 * Validates untrusted input into a normalized `WorkoutInput`, throwing a
 * clear-message `Error` on any malformed field. Returns a fresh object — the
 * caller's `input` is never mutated.
 */
export function parseWorkoutInput(input: unknown): WorkoutInput {
  const obj = asRecord(input, 'workout input must be an object')

  if (!Array.isArray(obj.exercises) || obj.exercises.length === 0) {
    throw new Error('a workout needs at least one exercise')
  }

  const exercises = obj.exercises.map(parseExercise)
  const name = parseName(obj.name)
  const startedAt = parseStartedAt(obj.startedAt)
  const completedAt = parsePastDate(obj.completedAt, 'completedAt')
  if (startedAt && completedAt && completedAt.getTime() < startedAt.getTime()) {
    throw new Error("workout completedAt can't be before startedAt")
  }

  return {
    ...(name !== undefined && { name }),
    exercises,
    ...(startedAt && { startedAt }),
    ...(completedAt && { completedAt }),
  }
}
