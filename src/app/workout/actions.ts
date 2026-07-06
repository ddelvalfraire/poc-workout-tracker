'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { parseWorkoutInput } from '@/lib/workout-input'
import {
  saveWorkout,
  updateWorkout,
  deleteWorkout,
  getLastPerformance,
  type LastPerformance,
} from '@/db/workouts'
import { getWorkoutDraft, putWorkoutDraft, deleteWorkoutDraft } from '@/db/workout-drafts'
import { isDraftPayload, DRAFT_TTL_MS, draftKey } from '@/app/workout/new/draft-payload'

/**
 * Validates and persists a workout for the signed-in user, returning the new id.
 *
 * Validation runs here on the server — independent of any client-side checks —
 * so malformed input is rejected even if the browser sends it directly. A throw
 * (auth redirect, validation failure, or DB error) surfaces to the caller as a
 * rejected action; the client component is expected to `try/catch` it.
 */
export async function saveWorkoutAction(input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseWorkoutInput(input)
  const result = await saveWorkout(userId, parsed)
  // The saved workout supersedes the /workout/new draft on every device.
  await deleteWorkoutDraft(userId, draftKey())
  revalidatePath('/') // keep the (future) home history list fresh
  return result
}

/**
 * Validates and applies an edit to an owned workout, returning its id. A missing
 * result means the workout isn't owned (or was concurrently deleted); we throw
 * so the client's try/catch surfaces an inline error.
 */
export async function updateWorkoutAction(id: string, input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseWorkoutInput(input)
  const result = await updateWorkout(userId, id, parsed)
  if (!result) throw new Error('workout not found')
  // The saved edit supersedes this workout's draft on every device.
  await deleteWorkoutDraft(userId, draftKey(id))
  revalidatePath('/')
  revalidatePath(`/workout/${id}`)
  return result
}

/**
 * Deletes an owned workout (children cascade). Returns void — the client
 * navigates home after; we must NOT redirect() here, as the client wraps the
 * call in try/catch and would mistake NEXT_REDIRECT for a failure.
 *
 * A missing result means the workout isn't owned (or was already deleted); we
 * throw so the client surfaces an error rather than navigating away as if it
 * had worked — mirroring updateWorkoutAction's ownership handling.
 */
export async function deleteWorkoutAction(id: string): Promise<void> {
  const userId = await requireUserId()
  const [deleted] = await deleteWorkout(userId, id)
  if (!deleted) throw new Error('workout not found')
  // Drop any draft keyed to this workout — an orphaned draft keeps the home
  // "workout in progress" banner alive with a Resume that 404s.
  await deleteWorkoutDraft(userId, draftKey(id))
  revalidatePath('/')
}

/**
 * The signed-in user's most recent prior performance of an exercise, or null.
 * Read-only — no revalidate. `excludeWorkoutId` omits the workout being edited so
 * it doesn't report itself. Used by the logger to seed per-set "last time" ghosts.
 */
export async function getLastPerformanceAction(
  wgerExerciseId: unknown,
  excludeWorkoutId?: unknown,
): Promise<LastPerformance | null> {
  const userId = await requireUserId()
  if (!Number.isInteger(wgerExerciseId) || (wgerExerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  const exclude = typeof excludeWorkoutId === 'string' ? excludeWorkoutId : undefined
  return getLastPerformance(userId, wgerExerciseId as number, exclude)
}

// ---------------------------------------------------------------------------
// Cross-device workout drafts. The logger autosaves its in-progress state
// through these; the payload is opaque jsonb validated on both sides of the
// wire (isDraftPayload here, parseDraftPayload on restore).

// 'new' (the /workout/new surface) or a workout uuid (edit surfaces). Guarding
// the shape keeps arbitrary strings out of the key column; keys are
// lower-cased first so 'NEW' or an uppercase-uuid URL can't mint a second
// surface for the same session.
const DRAFT_KEY_RE = /^(new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

// Generous ceiling for one session's draft; blocks abuse of the jsonb column.
const MAX_DRAFT_PAYLOAD_BYTES = 32_768

function parseDraftKey(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('invalid draft key')
  const key = raw.toLowerCase()
  if (!DRAFT_KEY_RE.test(key)) throw new Error('invalid draft key')
  return key
}

/**
 * The stored draft payload for a logging surface, or null. Enforces the TTL
 * against the row's authoritative `updated_at`, lazily deleting expired rows —
 * an abandoned draft from last week should not hijack today's session.
 */
export async function getWorkoutDraftAction(key: unknown): Promise<unknown | null> {
  const userId = await requireUserId()
  const parsedKey = parseDraftKey(key)
  const row = await getWorkoutDraft(userId, parsedKey)
  if (!row) return null
  if (Date.now() - row.updatedAt.getTime() > DRAFT_TTL_MS) {
    await deleteWorkoutDraft(userId, parsedKey)
    return null
  }
  return row.payload
}

/**
 * Upserts the draft for a logging surface (last writer wins across devices).
 * Validates structure and size here on the server — the payload is client
 * data and must never land in the column unchecked.
 */
export async function putWorkoutDraftAction(key: unknown, payload: unknown): Promise<void> {
  const userId = await requireUserId()
  const parsedKey = parseDraftKey(key)
  if (!isDraftPayload(payload)) throw new Error('invalid draft payload')
  if (JSON.stringify(payload).length > MAX_DRAFT_PAYLOAD_BYTES) {
    throw new Error('draft payload too large')
  }
  await putWorkoutDraft(userId, parsedKey, payload)
}

/** Deletes the draft for a logging surface (the user cleared the session out). */
export async function deleteWorkoutDraftAction(key: unknown): Promise<void> {
  const userId = await requireUserId()
  await deleteWorkoutDraft(userId, parseDraftKey(key))
}
