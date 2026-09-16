import type { WorkoutDraft, DraftExercise, DraftSet } from './workout-draft'
import { isWeightUnit, type WeightUnit } from '@/lib/units'
import { isLoggingType, isMetricMode, isWorkoutSetType } from '@/lib/workout/workout-input'

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

/**
 * Longest gap since a draft's last touch that still reads as the session the
 * lifter is CURRENTLY in.
 *
 * Deliberately NOT a TTL: nothing is deleted when it passes. A draft past this
 * window is an abandoned session, not a forfeited one — it stops auto-seeding
 * the shared 'new' surface and stops claiming the home banner, and that is
 * all. It WAS a TTL once, enforced with a hard delete on read: a session
 * logged in the evening and reopened the next morning was destroyed by the
 * act of opening the app, while the workout row it belonged to lived on
 * presenting an empty logger as an active session.
 */
export const LIVE_SESSION_MAX_AGE_MS = 12 * 60 * 60_000

/** The shared ad-hoc logging surface — one row for every /workout/new session. */
export const DRAFT_KEY_NEW = 'new'

/** One draft row per logging surface: 'new' for /workout/new, the workout id for edit mode. */
export function draftKey(workoutId?: string): string {
  return workoutId ?? DRAFT_KEY_NEW
}

/**
 * May this stored draft seed its surface WITHOUT the user asking for it?
 *
 * Two independent ways the answer is no, and nothing else:
 *
 * 1. HIJACK. Only 'new' can be hijacked — it is one row shared by every ad-hoc
 *    session, so yesterday's abandoned draft seeding it would put stale sets in
 *    front of a lifter who asked for a fresh one. That is the risk the age
 *    check was added for. A draft keyed by a workout id addresses exactly ONE
 *    session, the one it was written for, so it has nothing to hijack and no
 *    honest reason to age out: the workout row it belongs to never ages out
 *    either.
 *
 * 2. SUPERSESSION. A draft last touched BEFORE its workout's record was
 *    written is older evidence than the rows it would overwrite — a leftover
 *    from a save whose draft delete didn't land. `recordedAt` is the workout's
 *    `completedAt`, used here purely as WHEN THE RECORD WAS LAST WRITTEN, not
 *    as a mode signal (the schema is explicit that it cannot answer "is this
 *    session live" — see workout-session-mode.ts). A draft touched AFTER it is
 *    a correction in progress and still wins, which is what keeps unsaved
 *    edits to a finished workout alive.
 *
 * One predicate, so the page seed (resolveDraftSeed) and the client restore
 * (getWorkoutDraftAction) can never disagree about what resumes by itself.
 */
export function isAutoResumable(opts: {
  key: string
  updatedAt: Date
  now: Date
  /** The workout's `completedAt`; omitted/null when no record exists yet. */
  recordedAt?: Date | null
}): boolean {
  if (opts.recordedAt && opts.updatedAt.getTime() < opts.recordedAt.getTime()) return false
  if (opts.key !== DRAFT_KEY_NEW) return true
  return opts.now.getTime() - opts.updatedAt.getTime() <= LIVE_SESSION_MAX_AGE_MS
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
    typeof set.completed === 'boolean' &&
    // Absent = a payload persisted before warm-up tags; parseDraftPayload
    // defaults it on restore. Present-but-unrecognized is rejected.
    (set.tag === undefined || isWorkoutSetType(set.tag)) &&
    // Effort fields stay optional forever (DraftSet declares them so);
    // present-but-wrong-typed is rejected like any malformed field.
    (set.rir === undefined || typeof set.rir === 'string') &&
    (set.rpe === undefined || typeof set.rpe === 'string') &&
    // Cardio fields follow the same optional-forever contract: absent = a
    // pre-cardio payload (or a plain reps_weight set); present values must
    // be well-typed, and an unrecognized metricMode is rejected.
    (set.metricMode === undefined || isMetricMode(set.metricMode)) &&
    (set.duration === undefined || typeof set.duration === 'string') &&
    (set.distance === undefined || typeof set.distance === 'string') &&
    // Set-note fields (notes v2) keep the same optional-forever contract:
    // absent = a pre-notes payload; present must be well-typed strings.
    (set.note === undefined || typeof set.note === 'string') &&
    (set.noteClientKey === undefined || typeof set.noteClientKey === 'string')
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
    // Same optional-on-the-wire treatment for the source discriminator.
    (exercise.source === undefined || exercise.source === 'wger' || exercise.source === 'custom') &&
    // Absent = a payload persisted before notes/skip existed; parseDraftPayload
    // defaults both on restore. Present-but-wrong-typed is rejected.
    (exercise.notes === undefined || typeof exercise.notes === 'string') &&
    (exercise.skipped === undefined || typeof exercise.skipped === 'boolean') &&
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
  // Optional for pre-notes payloads; parseDraftPayload defaults it on restore.
  if (draft.notes !== undefined && typeof draft.notes !== 'string') return false
  return draft.exercises.every(isDraftExercise)
}

/**
 * Parses a stored payload into restorable state, or `null` when it can't be
 * trusted or doesn't match the active weight unit. Freshness is NOT checked
 * here — `isAutoResumable` weighs the row's authoritative `updated_at`, and
 * this function only decodes whatever it is handed.
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
        // Pre-discriminator payloads predate custom exercises entirely.
        source: exercise.source ?? 'wger',
        // Pre-notes/skip payloads: no note, nothing skipped.
        notes: exercise.notes ?? '',
        skipped: exercise.skipped ?? false,
        // Pre-tag payloads hold working sets only (the tag didn't exist).
        sets: exercise.sets.map((set) => ({ ...set, tag: set.tag ?? 'working' })),
      })),
      // Same pre-notes default at the workout level.
      notes: value.draft.notes ?? '',
    },
    name: value.name,
    openedAt: openedAt.getTime() > opts.now.getTime() ? opts.now : openedAt,
  }
}

/**
 * Server-side draft seeding, shared by both logger pages: a stored draft row
 * projected into logger seed values, or null when there is nothing this
 * surface may resume on its own.
 *
 * Skipping is ALL that happens here — a page render is a GET and must not
 * mutate. Nothing deletes the row it skipped either: a draft this surface
 * won't auto-resume is still the lifter's session, waiting for an explicit
 * recovery rather than for garbage collection.
 */
export function resolveDraftSeed(
  row: { payload: unknown; updatedAt: Date } | undefined | null,
  opts: { unit: WeightUnit; now: Date; key: string; recordedAt?: Date | null },
): { draft: WorkoutDraft; name: string; openedAt: Date } | null {
  if (!row) return null
  if (!isAutoResumable({ ...opts, updatedAt: row.updatedAt })) return null
  return parseDraftPayload(row.payload, opts)
}
