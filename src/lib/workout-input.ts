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

/**
 * How an exercise's sets are logged and how their `weight` column reads
 * (Hevy-style). The type lives on the EXERCISE (not the set) — a movement is
 * bodyweight or it isn't; per-set drift would make history incomparable.
 *   weight_reps          → weight is the total load
 *   bodyweight_reps      → weight is ignored (null); the lifter IS the load
 *   weighted_bodyweight  → weight is ADDED load on top of bodyweight
 *   assisted_bodyweight  → weight is ASSISTANCE subtracted from bodyweight
 */
export const LOGGING_TYPES = [
  'weight_reps',
  'bodyweight_reps',
  'weighted_bodyweight',
  'assisted_bodyweight',
] as const
export type LoggingType = (typeof LOGGING_TYPES)[number]

/** Narrows untrusted input (action payloads, DB text) to a LoggingType. */
export function isLoggingType(value: unknown): value is LoggingType {
  return (LOGGING_TYPES as readonly unknown[]).includes(value)
}

/** The logged set-type tags — the subset of program_sets' set_type that is a
 *  performed fact, not a prescription (backoff/amrap stay plan-side). */
export const SET_TYPES = ['working', 'warmup'] as const
export type WorkoutSetType = (typeof SET_TYPES)[number]

/** Narrows untrusted input (action payloads, DB text) to a WorkoutSetType. */
export function isWorkoutSetType(value: unknown): value is WorkoutSetType {
  return (SET_TYPES as readonly unknown[]).includes(value)
}

/** A single logged set. `null` means the field was left blank. */
export interface SetInput {
  reps: number | null
  weight: number | null
  /** True when the lifter checked the set off in-session; absent = false. */
  completed?: boolean
  /** Warm-up tag; absent = 'working' (the column default). Warm-ups are
   *  preparation, not record attempts — scorers must skip them. */
  setType?: WorkoutSetType
}

/** One exercise within a workout, with its logged sets. */
export interface ExerciseInput {
  wgerExerciseId: number
  /** Exercise identity is the composite (source, id); absent = 'wger'
   *  (the column default) so pre-discriminator callers keep their shape. */
  source?: 'wger' | 'custom'
  name: string
  /** How the sets' weights read; absent = 'weight_reps' (the column default). */
  loggingType?: LoggingType
  /** Free-form per-exercise note; absent = none (the column stores null). */
  notes?: string
  /** Skipped in-session; absent = false (the column default). Skipping never
   *  completes or deletes the sets — they save uncompleted. */
  skipped?: boolean
  sets: SetInput[]
}

/** A full workout ready to persist. */
export interface WorkoutInput {
  name?: string
  /** Free-form session note; absent = none (the column stores null). */
  notes?: string
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
// Generous free-text ceiling for notes — long enough for a paragraph of
// session context, short enough to keep a hostile payload out of the row.
const MAX_NOTES = 2000
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

/** Validates an optional free-text note: must be a string; blank/whitespace →
 *  omitted; over the cap → rejected (same reject-don't-truncate rule as name).
 *  Exported so the MCP meta tools validate notes through this exact rule. */
export function parseNotes(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw new Error(`${field} notes must be a string`)
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length > MAX_NOTES) throw new Error(`${field} notes must be ${MAX_NOTES} characters or fewer`)
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

  const { completed } = obj
  if (completed !== undefined && completed !== null && typeof completed !== 'boolean') {
    throw new Error('set completed must be a boolean')
  }

  // Same whitelist rule as loggingType: absent/null → column default
  // ('working'); a typo'd tag would silently mis-score records.
  const { setType } = obj
  if (setType !== undefined && setType !== null && !isWorkoutSetType(setType)) {
    throw new Error(`set setType must be one of ${SET_TYPES.join(', ')}`)
  }

  return {
    reps: reps as number | null,
    weight: weight as number | null,
    ...(typeof completed === 'boolean' && { completed }),
    ...(isWorkoutSetType(setType) && { setType }),
  }
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

  // Missing/null means the caller predates logging types (or doesn't care):
  // accept and let the column default ('weight_reps') apply. Anything present
  // must be on the whitelist — a typo'd type would silently mis-score history.
  const { loggingType } = obj
  if (loggingType !== undefined && loggingType !== null && !isLoggingType(loggingType)) {
    throw new Error(`exercise loggingType must be one of ${LOGGING_TYPES.join(', ')}`)
  }

  // Same whitelist rule as loggingType: absent/null → column default ('wger');
  // a typo'd source would silently fork an exercise's identity.
  const { source } = obj
  if (source !== undefined && source !== null && source !== 'wger' && source !== 'custom') {
    throw new Error("exercise source must be 'wger' or 'custom'")
  }

  const notes = parseNotes(obj.notes, 'exercise')

  // Absent/null → omitted so the column default (false) applies; anything
  // else must be a real boolean — a truthy string must not mark work skipped.
  const { skipped } = obj
  if (skipped !== undefined && skipped !== null && typeof skipped !== 'boolean') {
    throw new Error('exercise skipped must be a boolean')
  }

  if (!Array.isArray(obj.sets)) throw new Error('exercise sets must be an array')
  const sets = obj.sets.map(parseSet)

  return {
    wgerExerciseId: wgerExerciseId as number,
    name: trimmedName,
    ...(isLoggingType(loggingType) && { loggingType }),
    ...((source === 'wger' || source === 'custom') && { source }),
    ...(notes !== undefined && { notes }),
    ...(typeof skipped === 'boolean' && { skipped }),
    sets,
  }
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
  const notes = parseNotes(obj.notes, 'workout')
  const startedAt = parseStartedAt(obj.startedAt)
  const completedAt = parsePastDate(obj.completedAt, 'completedAt')
  if (startedAt && completedAt && completedAt.getTime() < startedAt.getTime()) {
    throw new Error("workout completedAt can't be before startedAt")
  }

  return {
    ...(name !== undefined && { name }),
    ...(notes !== undefined && { notes }),
    exercises,
    ...(startedAt && { startedAt }),
    ...(completedAt && { completedAt }),
  }
}
