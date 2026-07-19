/**
 * Trust boundary for standalone workout templates — the shared contract
 * between the derive/edit surfaces, the Server Actions, and the DB layer
 * (`db/workout-templates.ts`). Mirrors `parseWorkoutInput`'s hand-rolled,
 * field-by-field style: `unknown` in, a fresh normalized object (or a throw)
 * out, nothing coerced silently, the input never mutated.
 *
 * A template's set plan is deliberately compact (plannedSets + rep range +
 * rest), so the bounds here are tight sanity caps, not column ceilings.
 */
import { isLoggingType, parseNotes, LOGGING_TYPES, type LoggingType } from './workout-input'
import type { ExerciseSource } from './custom-exercise-input'

const MAX_NAME = 200 // same ceiling as workout/exercise names
const MAX_DESCRIPTION = 2000 // same free-text ceiling as notes
// An icon is an emoji or short token for list rows, never prose.
const MAX_ICON = 16
export const MIN_PLANNED_SETS = 1
export const MAX_PLANNED_SETS = 10
const MIN_REPS = 1
const MAX_REPS = 100
const MIN_REST_SEC = 0
const MAX_REST_SEC = 600
// Guards a hostile payload from writing an unbounded exercise list.
const MAX_EXERCISES = 30

/** One exercise in a template's sketch. Optional fields follow the workout
 *  input convention: absent → the column default (or null) applies. */
export interface TemplateExerciseInput {
  wgerExerciseId: number
  source?: ExerciseSource
  name: string
  loggingType?: LoggingType
  notes?: string
  plannedSets: number
  repMin?: number
  repMax?: number
  restSec?: number
}

/** A full template ready to persist. */
export interface WorkoutTemplateInput {
  name: string
  description?: string
  icon?: string
  exercises: TemplateExerciseInput[]
}

/** The editable metadata subset (the detail page's small edit form).
 *  `description`/`icon` are full-replace: absent → cleared to null. */
export interface TemplateMetaInput {
  name: string
  description?: string
  icon?: string
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error(message)
  return value as Record<string, unknown>
}

/** Validates a REQUIRED name (unlike a workout's optional one — a template is
 *  a list entry and must be findable by name). */
function parseRequiredName(raw: unknown, field: string): string {
  if (typeof raw !== 'string') throw new Error(`${field} name must be a string`)
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error(`${field} name must not be empty`)
  if (trimmed.length > MAX_NAME) {
    throw new Error(`${field} name must be ${MAX_NAME} characters or fewer`)
  }
  return trimmed
}

/** Optional short free text (description/icon): blank → omitted; over the cap
 *  → rejected (reject-don't-truncate, same rule as names/notes). */
function parseOptionalText(raw: unknown, field: string, max: number): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw new Error(`template ${field} must be a string`)
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length > max) throw new Error(`template ${field} must be ${max} characters or fewer`)
  return trimmed
}

/** Optional bounded integer: absent/null → omitted; anything present must be
 *  an integer within [min, max] — a fractional or out-of-range value throws. */
function parseBoundedInt(
  raw: unknown,
  field: string,
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Number.isInteger(raw) || (raw as number) < min || (raw as number) > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`)
  }
  return raw as number
}

function parseTemplateExercise(raw: unknown): TemplateExerciseInput {
  const obj = asRecord(raw, 'each template exercise must be an object')

  // Positive ids only — same rule as the workout_exercises CHECK.
  const { wgerExerciseId } = obj
  if (!Number.isInteger(wgerExerciseId) || (wgerExerciseId as number) <= 0) {
    throw new Error('template exercise wgerExerciseId must be a positive integer')
  }

  const name = parseRequiredName(obj.name, 'template exercise')

  // Whitelist rules shared with parseWorkoutInput: absent/null → the column
  // default; anything present must be a known value.
  const { loggingType } = obj
  if (loggingType !== undefined && loggingType !== null && !isLoggingType(loggingType)) {
    throw new Error(`template exercise loggingType must be one of ${LOGGING_TYPES.join(', ')}`)
  }
  const { source } = obj
  if (source !== undefined && source !== null && source !== 'wger' && source !== 'custom') {
    throw new Error("template exercise source must be 'wger' or 'custom'")
  }

  const notes = parseNotes(obj.notes, 'template exercise')

  const { plannedSets } = obj
  if (
    !Number.isInteger(plannedSets) ||
    (plannedSets as number) < MIN_PLANNED_SETS ||
    (plannedSets as number) > MAX_PLANNED_SETS
  ) {
    throw new Error(
      `template exercise plannedSets must be an integer between ${MIN_PLANNED_SETS} and ${MAX_PLANNED_SETS}`,
    )
  }

  const repMin = parseBoundedInt(obj.repMin, 'template exercise repMin', MIN_REPS, MAX_REPS)
  const repMax = parseBoundedInt(obj.repMax, 'template exercise repMax', MIN_REPS, MAX_REPS)
  if (repMin !== undefined && repMax !== undefined && repMin > repMax) {
    throw new Error('template exercise repMin must not exceed repMax')
  }
  const restSec = parseBoundedInt(
    obj.restSec,
    'template exercise restSec',
    MIN_REST_SEC,
    MAX_REST_SEC,
  )

  return {
    wgerExerciseId: wgerExerciseId as number,
    name,
    ...((source === 'wger' || source === 'custom') && { source }),
    ...(isLoggingType(loggingType) && { loggingType }),
    ...(notes !== undefined && { notes }),
    plannedSets: plannedSets as number,
    ...(repMin !== undefined && { repMin }),
    ...(repMax !== undefined && { repMax }),
    ...(restSec !== undefined && { restSec }),
  }
}

/**
 * Validates untrusted input into a normalized `WorkoutTemplateInput`, throwing
 * a clear-message `Error` on any malformed field. Returns a fresh object.
 */
export function parseTemplateInput(input: unknown): WorkoutTemplateInput {
  const obj = asRecord(input, 'template input must be an object')

  const name = parseRequiredName(obj.name, 'template')
  const description = parseOptionalText(obj.description, 'description', MAX_DESCRIPTION)
  const icon = parseOptionalText(obj.icon, 'icon', MAX_ICON)

  if (!Array.isArray(obj.exercises) || obj.exercises.length === 0) {
    throw new Error('a template needs at least one exercise')
  }
  if (obj.exercises.length > MAX_EXERCISES) {
    throw new Error(`a template can hold at most ${MAX_EXERCISES} exercises`)
  }
  const exercises = obj.exercises.map(parseTemplateExercise)

  return {
    name,
    ...(description !== undefined && { description }),
    ...(icon !== undefined && { icon }),
    exercises,
  }
}

/**
 * Validates the metadata-only edit (rename / description / icon). Same rules
 * as the full input's header fields; exercises are untouchable through this
 * path — reshaping the sketch means saving a new template.
 */
export function parseTemplateMeta(input: unknown): TemplateMetaInput {
  const obj = asRecord(input, 'template meta must be an object')
  const name = parseRequiredName(obj.name, 'template')
  const description = parseOptionalText(obj.description, 'description', MAX_DESCRIPTION)
  const icon = parseOptionalText(obj.icon, 'icon', MAX_ICON)
  return {
    name,
    ...(description !== undefined && { description }),
    ...(icon !== undefined && { icon }),
  }
}
