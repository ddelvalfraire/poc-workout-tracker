import type { WorkoutDraft, DraftExercise, DraftSet } from './workout-draft'
import { isWeightUnit, type WeightUnit } from '@/lib/units'
import { isLoggingType } from '@/lib/workout-input'

/**
 * Pure build/parse for the cross-device draft snapshot the logger autosaves to
 * the server (`workout_drafts.payload`), so a session started on one device
 * can be finished on another. Like `workout-draft.ts`, this module is free of
 * React and I/O — the logger and Server Actions own the wire calls — so it
 * unit-tests as plain functions.
 *
 * `isDraftPayload` is a trust boundary in the spirit of `parseWorkoutInput`:
 * the payload crosses the network twice (client → action on save, DB → client
 * on restore), so both sides re-validate the full shape and reject rather
 * than coerce. Weights inside the draft are display-unit strings, so a
 * payload written under a different unit preference is discarded on restore
 * instead of lossily converted.
 */

export const DRAFT_PAYLOAD_VERSION = 1

/** Longest plausible gap within one session; older drafts are abandoned workouts. */
export const DRAFT_TTL_MS = 12 * 60 * 60_000

/** One draft row per logging surface: 'new' for /workout/new, the workout id for edit mode. */
export function draftKey(workoutId?: string): string {
  return workoutId ?? 'new'
}

/** The JSON shape stored in `workout_drafts.payload`. `openedAt` is ISO. */
export interface DraftPayload {
  v: number
  unit: WeightUnit
  name: string
  openedAt: string
  draft: WorkoutDraft
}

export function buildDraftPayload(input: {
  draft: WorkoutDraft
  name: string
  unit: WeightUnit
  openedAt: Date
}): DraftPayload {
  return {
    v: DRAFT_PAYLOAD_VERSION,
    unit: input.unit,
    name: input.name,
    openedAt: input.openedAt.toISOString(),
    draft: input.draft,
  }
}

function isDraftSet(value: unknown): value is DraftSet {
  if (!value || typeof value !== 'object') return false
  const set = value as Record<string, unknown>
  return (
    typeof set.id === 'string' &&
    typeof set.reps === 'string' &&
    typeof set.weight === 'string' &&
    typeof set.completed === 'boolean'
  )
}

function isDraftExercise(value: unknown): value is DraftExercise {
  if (!value || typeof value !== 'object') return false
  const exercise = value as Record<string, unknown>
  return (
    typeof exercise.id === 'string' &&
    typeof exercise.wgerExerciseId === 'number' &&
    typeof exercise.name === 'string' &&
    typeof exercise.category === 'string' &&
    // Absent = a payload persisted before logging types; parseDraftPayload
    // defaults it on restore. Present-but-unrecognized is rejected like any
    // other malformed field.
    (exercise.loggingType === undefined || isLoggingType(exercise.loggingType)) &&
    Array.isArray(exercise.sets) &&
    exercise.sets.every(isDraftSet)
  )
}

/**
 * Structural guard for an untrusted payload: version, a recognized unit, a
 * parseable openedAt, and a full field-walk of the draft tree. Rejects an
 * empty draft — there is nothing worth storing or restoring. Used by the put
 * action (client → server) and by `parseDraftPayload` (server → client).
 */
export function isDraftPayload(value: unknown): value is DraftPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>

  if (payload.v !== DRAFT_PAYLOAD_VERSION) return false
  if (typeof payload.unit !== 'string' || !isWeightUnit(payload.unit)) return false
  if (typeof payload.name !== 'string') return false
  if (typeof payload.openedAt !== 'string' || Number.isNaN(new Date(payload.openedAt).getTime()))
    return false

  const draft = payload.draft as Record<string, unknown> | null
  if (!draft || typeof draft !== 'object' || !Array.isArray(draft.exercises)) return false
  if (draft.exercises.length === 0) return false
  return draft.exercises.every(isDraftExercise)
}

/**
 * Parses a stored payload into restorable state, or `null` when it can't be
 * trusted or doesn't match the active weight unit. TTL is NOT checked here —
 * the server enforces it against the row's authoritative `updated_at`.
 *
 * `openedAt` is clamped to `now`: a draft written by a device with a fast
 * clock would otherwise restore a future session start, which the eventual
 * save sends as `startedAt` and parseWorkoutInput rejects (no future dates) —
 * turning cross-device clock skew into an opaque save error.
 */
export function parseDraftPayload(
  value: unknown,
  opts: { unit: WeightUnit; now: Date },
): { draft: WorkoutDraft; name: string; openedAt: Date } | null {
  if (!isDraftPayload(value)) return null
  if (value.unit !== opts.unit) return null
  const openedAt = new Date(value.openedAt)
  return {
    draft: {
      // The guard accepts a pre-logging-type payload (no loggingType field);
      // the restored state is fully controlled, so default it here.
      exercises: value.draft.exercises.map((exercise) => ({
        ...exercise,
        loggingType: exercise.loggingType ?? 'weight_reps',
      })),
    },
    name: value.name,
    openedAt: openedAt.getTime() > opts.now.getTime() ? opts.now : openedAt,
  }
}

/**
 * Server-side draft seeding, shared by both logger pages: a stored draft row
 * projected into logger seed values, or null when there is nothing usable.
 * TTL mirrors getWorkoutDraftAction (inclusive <=) but only SKIPS a stale
 * row — a page render is a GET and must not mutate; the client action still
 * lazily deletes expired rows.
 */
export function resolveDraftSeed(
  row: { payload: unknown; updatedAt: Date } | undefined | null,
  opts: { unit: WeightUnit; now: Date },
): { draft: WorkoutDraft; name: string; openedAt: Date } | null {
  if (!row) return null
  if (opts.now.getTime() - row.updatedAt.getTime() > DRAFT_TTL_MS) return null
  return parseDraftPayload(row.payload, opts)
}
