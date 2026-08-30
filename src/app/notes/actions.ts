'use server'

import { requireUserId } from '@/lib/auth'
import { isNoteAnchorKind, parseNoteAnchor, parseNoteBody } from '@/lib/notes/note-input'
import {
  createNote,
  createPositionalSetNote,
  createWorkoutFallbackNote,
  updateNote,
  deleteNote,
  listNotes,
  type ListNotesFilters,
  type NoteRow,
  type NoteWithContext,
} from '@/db/notes'

/**
 * Server actions for notes-v2. Validation runs here on the server (the
 * note-input boundary), independent of any client checks; ownership is
 * enforced by the db layer (anchor join chain / owner-scoped wheres).
 *
 * Deliberately NO revalidatePath anywhere: a note save during a live session
 * must not re-render the logger route (the #214 lesson — a Server-Action
 * revalidation re-runs the whole logger page under the app-wide
 * <ViewTransition>). The browser/read surfaces render dynamically per
 * request, so the only staleness is the client router cache's brief TTL.
 * Author is always 'user' here — the coach WRITE path is gated behind the
 * coach surface and does not pass through these actions.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function parseNoteId(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('invalid note id')
  const id = raw.toLowerCase()
  if (!UUID_RE.test(id)) throw new Error('invalid note id')
  return id
}

/**
 * Creates a note on an owned anchor. Throws on invalid input or when the
 * anchor isn't owned/doesn't exist (the client try/catches, like every other
 * action here). `clientKey` (optional, a client uuid — the offline queue
 * passes its PendingNote.id) makes the create idempotent: a replayed flush
 * returns the already-created row instead of duplicating it.
 */
export async function createNoteAction(
  anchor: unknown,
  body: unknown,
  clientKey?: unknown,
): Promise<NoteRow> {
  const userId = await requireUserId()
  const parsedAnchor = parseNoteAnchor(anchor)
  const parsedBody = parseNoteBody(body)
  let parsedClientKey: string | undefined
  if (clientKey !== undefined && clientKey !== null) {
    if (typeof clientKey !== 'string' || !UUID_RE.test(clientKey.toLowerCase())) {
      throw new Error('invalid client key')
    }
    parsedClientKey = clientKey.toLowerCase()
  }
  const row = await createNote(userId, parsedAnchor, parsedBody, {
    ...(parsedClientKey !== undefined ? { clientKey: parsedClientKey } : {}),
  })
  if (!row) throw new Error('note anchor not found')
  return row
}

/** Sanity ceiling for one batch — a session tops out well under this. */
const MAX_SET_NOTE_BATCH = 100
/** Positions/set numbers far past any real workout are junk, not input. */
const MAX_POSITION = 500

function parsePositionalEntry(raw: unknown, index: number): {
  exercisePosition: number
  setNumber: number
  body: string
  clientKey: string
} {
  if (!raw || typeof raw !== 'object') throw new Error(`invalid set note entry ${index}`)
  const entry = raw as Record<string, unknown>
  const { exercisePosition, setNumber, clientKey } = entry
  if (
    !Number.isInteger(exercisePosition) ||
    (exercisePosition as number) < 0 ||
    (exercisePosition as number) > MAX_POSITION
  ) {
    throw new Error(`invalid exercisePosition in set note entry ${index}`)
  }
  if (!Number.isInteger(setNumber) || (setNumber as number) < 1 || (setNumber as number) > MAX_POSITION) {
    throw new Error(`invalid setNumber in set note entry ${index}`)
  }
  if (typeof clientKey !== 'string' || !UUID_RE.test(clientKey.toLowerCase())) {
    throw new Error(`invalid clientKey in set note entry ${index}`)
  }
  return {
    exercisePosition: exercisePosition as number,
    setNumber: setNumber as number,
    body: parseNoteBody(entry.body),
    clientKey: clientKey.toLowerCase(),
  }
}

/**
 * Batch-creates capture-sheet SET notes against a just-saved workout by
 * positional address (0-based exercise position, 1-based set number) — the
 * logger's post-save leg (see note-capture.ts for why set notes can't anchor
 * by id mid-session). Each entry is validated field-by-field; creation is
 * sequential and idempotent per clientKey, so the client may replay the whole
 * batch after a failure and only the missing rows land. Throws on invalid
 * input or an unowned workout (the client downgrades to the pending queue).
 */
export async function createSetNotesForWorkoutAction(
  workoutId: unknown,
  entries: unknown,
): Promise<void> {
  const userId = await requireUserId()
  if (typeof workoutId !== 'string' || !UUID_RE.test(workoutId.toLowerCase())) {
    throw new Error('invalid workout id')
  }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_SET_NOTE_BATCH) {
    throw new Error('invalid set note entries')
  }
  const parsed = entries.map((entry, index) => parsePositionalEntry(entry, index))
  const id = workoutId.toLowerCase()
  for (const entry of parsed) {
    const row = await createPositionalSetNote(userId, id, entry)
    if (!row) throw new Error('workout not found')
  }
}

/**
 * The pending-notes queue's send target for DOWNGRADED set notes (post-save
 * batch failed; positional info is gone by replay time): a workout-anchored
 * note with the marker snapshot that keeps it out of the canonical
 * session-note projection. Same clientKey idempotency as every create here.
 */
export async function createFallbackSetNoteAction(
  workoutId: unknown,
  body: unknown,
  clientKey: unknown,
): Promise<void> {
  const userId = await requireUserId()
  if (typeof workoutId !== 'string' || !UUID_RE.test(workoutId.toLowerCase())) {
    throw new Error('invalid workout id')
  }
  if (typeof clientKey !== 'string' || !UUID_RE.test(clientKey.toLowerCase())) {
    throw new Error('invalid client key')
  }
  const row = await createWorkoutFallbackNote(
    userId,
    workoutId.toLowerCase(),
    parseNoteBody(body),
    clientKey.toLowerCase(),
  )
  if (!row) throw new Error('workout not found')
}

/** Edits the body of the user's own (user-authored) note. */
export async function updateNoteAction(id: unknown, body: unknown): Promise<NoteRow> {
  const userId = await requireUserId()
  const noteId = parseNoteId(id)
  const parsedBody = parseNoteBody(body)
  const row = await updateNote(userId, noteId, parsedBody)
  if (!row) throw new Error('note not found')
  return row
}

/** Deletes one of the user's notes (any author — it's their data). */
export async function deleteNoteAction(id: unknown): Promise<void> {
  const userId = await requireUserId()
  const deleted = await deleteNote(userId, parseNoteId(id))
  if (!deleted) throw new Error('note not found')
}

/**
 * The browser read: the user's notes with anchor breadcrumbs, filterable.
 * Read-only — no revalidate. Filters are whitelisted field-by-field; unknown
 * keys are ignored rather than trusted.
 */
export async function listNotesAction(filters?: unknown): Promise<NoteWithContext[]> {
  const userId = await requireUserId()
  const parsed: ListNotesFilters = {}
  if (filters !== undefined && filters !== null) {
    if (typeof filters !== 'object') throw new Error('invalid notes filters')
    const f = filters as Record<string, unknown>
    if (f.anchorKind !== undefined) {
      if (!isNoteAnchorKind(f.anchorKind)) throw new Error('invalid anchor kind')
      parsed.anchorKind = f.anchorKind
    }
    for (const key of ['programId', 'workoutId', 'workoutExerciseId', 'setId'] as const) {
      const value = f[key]
      if (value === undefined) continue
      if (typeof value !== 'string' || !UUID_RE.test(value.toLowerCase())) {
        throw new Error(`invalid ${key}`)
      }
      parsed[key] = value.toLowerCase()
    }
    for (const key of ['limit', 'offset'] as const) {
      const value = f[key]
      if (value === undefined) continue
      if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`invalid ${key}`)
      parsed[key] = value as number
    }
  }
  return listNotes(userId, parsed)
}
