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

import { isValidRir, isValidRpe, RIR_MIN, RIR_MAX, RPE_MIN, RPE_MAX } from './effort'
import {
  isTechniqueKind,
  TECHNIQUE_KINDS,
  type SetTechnique,
  type TechniqueKind,
} from './technique'
export type { SetTechnique }

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

/**
 * How a set is measured (mirrors program_sets/sets `metric_mode`). Lives on
 * the SET (unlike loggingType) because that's where the schema puts it —
 * instantiation stamps it per row. `reps_weight` is the column default and
 * stays absent on the wire so every pre-cardio payload keeps its shape.
 */
export const METRIC_MODES = ['reps_weight', 'duration', 'duration_distance'] as const
export type WorkoutMetricMode = (typeof METRIC_MODES)[number]

/** Narrows untrusted input (action payloads, DB text) to a WorkoutMetricMode. */
export function isMetricMode(value: unknown): value is WorkoutMetricMode {
  return (METRIC_MODES as readonly unknown[]).includes(value)
}

/** The metric mode a freshly added exercise's sets default to: wger's Cardio
 *  category maps to duration+distance logging (the competitor-standard cardio
 *  model); everything else stays reps × weight. Mapping happens at ADD time
 *  (logger picks AND builder adds); the user can still flip the mode via the
 *  builder's control. Shared here so the two drafts can never disagree. */
export function defaultMetricModeForCategory(category: string): WorkoutMetricMode {
  return category.trim().toLowerCase() === 'cardio' ? 'duration_distance' : 'reps_weight'
}

/** The logged set-type tags — the subset of program_sets' set_type that is a
 *  performed fact, not a prescription (backoff/amrap stay plan-side). */
export const SET_TYPES = ['working', 'warmup'] as const
export type WorkoutSetType = (typeof SET_TYPES)[number]

/** Narrows untrusted input (action payloads, DB text) to a WorkoutSetType. */
export function isWorkoutSetType(value: unknown): value is WorkoutSetType {
  return (SET_TYPES as readonly unknown[]).includes(value)
}

/**
 * 0-based ordinal of `sets[setIndex]` within its own set-type CLASS —
 * warm-ups count among warm-ups, everything else among non-warm-ups — or
 * undefined when no set exists at `setIndex`. The ONE definition of the
 * role-ordinal rule: display numbering (setDisplayNumber in the logger
 * draft) and plan/history pairing (resolveByRole in lib/format) both build
 * on it, so the two can never drift.
 */
export function classOrdinal(
  sets: readonly { tag: string }[],
  setIndex: number,
): number | undefined {
  const set = sets[setIndex]
  if (set === undefined) return undefined
  const isWarmup = set.tag === 'warmup'
  let ordinal = 0
  for (let i = 0; i < setIndex; i++) {
    if ((sets[i].tag === 'warmup') === isWarmup) ordinal++
  }
  return ordinal
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
  /** Logged reps-in-reserve (0–10 int); absent/null = not logged. Stored
   *  alongside rpe, never converted (lib/effort.ts owns the ranges). */
  rir?: number | null
  /** Logged RPE (4–10, half steps); absent/null = not logged. */
  rpe?: number | null
  /** How this set is measured; absent = 'reps_weight' (the column default).
   *  Cardio sets carry 'duration'/'duration_distance' + the fields below. */
  metricMode?: WorkoutMetricMode
  /** Logged duration in seconds (cardio modes); absent/null = not logged. */
  durationSec?: number | null
  /** Logged distance in meters (duration_distance); absent/null = not logged. */
  distanceM?: number | null
  /** This row's place inside an intensity-technique group (a drop set, a
   *  rest-pause mini-set, …); absent = an ordinary set. ONE object, not three
   *  loose fields, because the three facts are only ever true together — a
   *  kind without a group would be an ungroupable stage. */
  technique?: SetTechnique
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
// A day of continuous work is the duration ceiling (lib/duration.ts shares it).
export const MAX_DURATION_SEC = 86_400
// distance_m is numeric(9,2) — 9,999,999.99 m is the column ceiling (mirrors
// MAX_DISTANCE_M in program-input.ts, which isn't exported there).
export const MAX_DISTANCE_M = 9_999_999.99
/** Group-key length cap — the key is a client-minted handle, never prose. */
const MAX_TECHNIQUE_GROUP = 64
/** Stage ceiling per technique group: a set with 33 drops is corruption, not
 *  a drop set, and each stage is a row that must not run away. */
const MAX_STAGE_INDEX = 32

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

/** Validates a single set: reps a non-negative integer or null, weight a non-negative finite number or null.
 *  `loggingType` is the owning exercise's effective logging type — the
 *  completed-set gate needs it because weight is only required reading for
 *  `weight_reps` (the three bodyweight modes read the weight column
 *  differently, or not at all). */
function parseSet(raw: unknown, loggingType: LoggingType): SetInput {
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

  // Effort fields: absent/null = not logged; anything present must sit on the
  // shared grid (lib/effort.ts) — an off-scale value would poison later
  // RIR-adjusted scoring the way a typo'd setType would mis-score records.
  const { rir } = obj
  if (rir !== undefined && rir !== null && (typeof rir !== 'number' || !isValidRir(rir))) {
    throw new Error(`set rir must be an integer between ${RIR_MIN} and ${RIR_MAX}, or null`)
  }

  const { rpe } = obj
  if (rpe !== undefined && rpe !== null && (typeof rpe !== 'number' || !isValidRpe(rpe))) {
    throw new Error(`set rpe must be between ${RPE_MIN} and ${RPE_MAX} in 0.5 steps, or null`)
  }

  // Metric mode: absent/null → column default ('reps_weight'); anything
  // present must be whitelisted — a typo'd mode would silently pull the set
  // out of (or into) volume/e1RM scoring.
  const { metricMode } = obj
  if (metricMode !== undefined && metricMode !== null && !isMetricMode(metricMode)) {
    throw new Error(`set metricMode must be one of ${METRIC_MODES.join(', ')}`)
  }

  const { durationSec } = obj
  if (
    durationSec !== undefined &&
    durationSec !== null &&
    (!Number.isInteger(durationSec) ||
      (durationSec as number) < 0 ||
      (durationSec as number) > MAX_DURATION_SEC)
  ) {
    throw new Error(`set durationSec must be an integer between 0 and ${MAX_DURATION_SEC}, or null`)
  }

  const { distanceM } = obj
  if (
    distanceM !== undefined &&
    distanceM !== null &&
    (!Number.isFinite(distanceM) ||
      (distanceM as number) < 0 ||
      (distanceM as number) > MAX_DISTANCE_M)
  ) {
    throw new Error(`set distanceM must be a number between 0 and ${MAX_DISTANCE_M} m, or null`)
  }

  // Technique grouping: absent = an ordinary set. Present means all three
  // facts, each whitelisted/bounded — a bad kind or a runaway stage index
  // would mis-credit weekly volume the way a typo'd setType mis-scores
  // records. Adjacency across the exercise's rows is checked in parseExercise,
  // the only place the whole group is visible.
  const technique = parseSetTechnique(obj.technique)

  // ---- Cross-field rules (the wire mirrors draftToInput's exclusivity) ----
  // A zero duration/distance carries no logged fact — normalize to null BEFORE
  // the gates below, so a completed set with `0` reads as missing its metric
  // and a stored 0 (unrepresentable by the edit codecs in lib/duration.ts)
  // never reaches a row.
  const mode: WorkoutMetricMode = isMetricMode(metricMode) ? metricMode : 'reps_weight'
  const normDurationSec = durationSec === 0 ? null : (durationSec as number | null | undefined)
  const normDistanceM = distanceM === 0 ? null : (distanceM as number | null | undefined)

  // Each mode speaks ONLY its own metrics. draftToInput already nulls the
  // irrelevant fields, so a non-null value here can only come from a non-draft
  // caller (MCP, hostile client) — refuse it rather than let a stray value
  // ride into scoring.
  if (mode === 'reps_weight') {
    if (normDurationSec != null) {
      throw new Error('a reps_weight set must not carry durationSec (set metricMode to a duration mode)')
    }
    if (normDistanceM != null) {
      throw new Error('a reps_weight set must not carry distanceM (set metricMode to duration_distance)')
    }
  } else {
    if (reps != null) throw new Error(`a ${mode} set must not carry reps`)
    if (weight != null) throw new Error(`a ${mode} set must not carry weight`)
    if (mode === 'duration' && normDistanceM != null) {
      throw new Error('a duration set must not carry distanceM (use duration_distance)')
    }
  }

  // #206 at the wire: a COMPLETED set must carry its required metric — weight
  // for weight_reps exercises (bodyweight modes are exempt), a positive
  // duration for the cardio modes. A completed set without its metric is a
  // phantom fact that would poison history and scoring.
  if (completed === true) {
    if (mode === 'reps_weight') {
      if (loggingType === 'weight_reps' && weight === null) {
        throw new Error('a completed set needs a weight when the exercise logs weight × reps')
      }
    } else if (normDurationSec == null) {
      throw new Error(`a completed ${mode} set needs a duration`)
    }
  }

  return {
    reps: reps as number | null,
    weight: weight as number | null,
    ...(typeof completed === 'boolean' && { completed }),
    ...(isWorkoutSetType(setType) && { setType }),
    ...(rir !== undefined && { rir: rir as number | null }),
    ...(rpe !== undefined && { rpe: rpe as number | null }),
    ...(isMetricMode(metricMode) && { metricMode }),
    ...(normDurationSec !== undefined && { durationSec: normDurationSec }),
    ...(normDistanceM !== undefined && { distanceM: normDistanceM }),
    ...(technique !== undefined && { technique }),
  }
}

/** Validates one set's technique grouping; undefined when absent (an ordinary
 *  set). Null is accepted as "absent" for callers that clear the field. */
function parseSetTechnique(raw: unknown): SetTechnique | undefined {
  if (raw === undefined || raw === null) return undefined
  const obj = asRecord(raw, 'set technique must be an object')

  const { kind } = obj
  if (!isTechniqueKind(kind)) {
    throw new Error(`set technique kind must be one of ${TECHNIQUE_KINDS.join(', ')}`)
  }

  const { group } = obj
  if (typeof group !== 'string' || group.trim().length === 0) {
    throw new Error('set technique group must be a non-empty string')
  }
  if (group.length > MAX_TECHNIQUE_GROUP) {
    throw new Error(`set technique group must be ${MAX_TECHNIQUE_GROUP} characters or fewer`)
  }

  const { stageIndex } = obj
  if (
    !Number.isInteger(stageIndex) ||
    (stageIndex as number) < 0 ||
    (stageIndex as number) > MAX_STAGE_INDEX
  ) {
    throw new Error(`set technique stageIndex must be an integer between 0 and ${MAX_STAGE_INDEX}`)
  }

  return { kind, group, stageIndex: stageIndex as number }
}

/**
 * Group-shape rule across ONE exercise's sets: a technique group must be a
 * CONTIGUOUS run of rows, opening at stage 0 and stepping by exactly 1, all
 * of one kind. That is what makes the group countable — weekly volume credits
 * the group once at stage 0 (lib/technique.ts), so a group with two stage 0s,
 * a gap, or rows split across the exercise would silently miscount the
 * lifter's hard sets. Rejected at the boundary rather than tolerated.
 */
function assertTechniqueGroups(sets: readonly SetInput[]): void {
  const seen = new Set<string>()
  let open: { group: string; kind: TechniqueKind; nextStage: number } | null = null
  for (const set of sets) {
    const technique = set.technique
    if (!technique) {
      open = null
      continue
    }
    if (open === null || open.group !== technique.group) {
      // Reopening first: a group split by an ordinary set is a more precise
      // diagnosis than the stage-0 rule its second run also trips.
      if (seen.has(technique.group)) {
        throw new Error(`technique group '${technique.group}' must be one contiguous run of sets`)
      }
      if (technique.stageIndex !== 0) {
        throw new Error(`technique group '${technique.group}' must open at stage 0`)
      }
      seen.add(technique.group)
      open = { group: technique.group, kind: technique.kind, nextStage: 1 }
      continue
    }
    if (technique.kind !== open.kind) {
      throw new Error(`technique group '${technique.group}' mixes kinds`)
    }
    if (technique.stageIndex !== open.nextStage) {
      throw new Error(`technique group '${technique.group}' must number its stages contiguously`)
    }
    open.nextStage += 1
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
  const effectiveLoggingType: LoggingType = isLoggingType(loggingType) ? loggingType : 'weight_reps'
  const sets = obj.sets.map((set) => parseSet(set, effectiveLoggingType))
  assertTechniqueGroups(sets)

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
