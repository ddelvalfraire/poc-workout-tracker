import type { WorkoutDraft, DraftExercise, DraftSet } from './workout-draft'
import type { WeightUnit } from '@/lib/units'

/**
 * Pure serialize/parse for the in-progress workout snapshot the logger keeps in
 * `localStorage` (so a refresh/tab-close/PWA suspend doesn't lose a live
 * session). Like `workout-draft.ts`, this module stays free of browser APIs —
 * no `window`, no `localStorage`, `now` always injected — so it unit-tests as
 * plain functions under Vitest's `node` environment; the logger component owns
 * the actual storage calls.
 *
 * `deserializeDraft` is a trust boundary in the spirit of `parseWorkoutInput`:
 * storage contents are external data, so every field is type-checked and any
 * problem returns `null` (restore is best-effort — never throw over a stale
 * snapshot). Weights are display-unit strings, so a snapshot from a different
 * unit preference is discarded rather than lossily converted.
 */

export const DRAFT_STORAGE_VERSION = 1

/** Longest plausible gap within one session; older snapshots are abandoned workouts. */
export const DRAFT_TTL_MS = 12 * 60 * 60_000

/** One key per logging surface: `new` for /workout/new, the workout id for edit mode. */
export function draftStorageKey(workoutId?: string): string {
  return `workout-draft:${workoutId ?? 'new'}`
}

/** The JSON shape written to storage. Dates are ISO strings. */
interface StoredDraft {
  v: number
  unit: WeightUnit
  name: string
  openedAt: string
  savedAt: string
  draft: WorkoutDraft
}

export function serializeDraft(input: {
  draft: WorkoutDraft
  name: string
  unit: WeightUnit
  openedAt: Date
  now: Date
}): string {
  const stored: StoredDraft = {
    v: DRAFT_STORAGE_VERSION,
    unit: input.unit,
    name: input.name,
    openedAt: input.openedAt.toISOString(),
    savedAt: input.now.toISOString(),
    draft: input.draft,
  }
  return JSON.stringify(stored)
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
    Array.isArray(exercise.sets) &&
    exercise.sets.every(isDraftSet)
  )
}

/**
 * Parses a stored snapshot back into restorable state, or `null` when it can't
 * be trusted: unparseable, wrong version, different weight unit, expired (or
 * clock-skewed into the future), invalid dates, malformed draft shape, or an
 * empty draft (nothing worth restoring).
 */
export function deserializeDraft(
  raw: string | null,
  opts: { unit: WeightUnit; now: Date },
): { draft: WorkoutDraft; name: string; openedAt: Date } | null {
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const stored = parsed as Record<string, unknown>

  if (stored.v !== DRAFT_STORAGE_VERSION) return null
  if (stored.unit !== opts.unit) return null
  if (typeof stored.name !== 'string') return null
  if (typeof stored.savedAt !== 'string' || typeof stored.openedAt !== 'string') return null

  const savedAt = new Date(stored.savedAt)
  const openedAt = new Date(stored.openedAt)
  if (Number.isNaN(savedAt.getTime()) || Number.isNaN(openedAt.getTime())) return null

  const age = opts.now.getTime() - savedAt.getTime()
  if (age < 0 || age > DRAFT_TTL_MS) return null

  const draft = stored.draft as Record<string, unknown> | null
  if (!draft || typeof draft !== 'object' || !Array.isArray(draft.exercises)) return null
  if (draft.exercises.length === 0) return null
  if (!draft.exercises.every(isDraftExercise)) return null

  return { draft: { exercises: draft.exercises }, name: stored.name, openedAt }
}
