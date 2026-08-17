'use server'

import { requireUserId } from '@/lib/auth'
import { isNoteAnchorKind, parseNoteAnchor, parseNoteBody } from '@/lib/note-input'
import {
  createNote,
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
 * action here).
 */
export async function createNoteAction(anchor: unknown, body: unknown): Promise<NoteRow> {
  const userId = await requireUserId()
  const parsedAnchor = parseNoteAnchor(anchor)
  const parsedBody = parseNoteBody(body)
  const row = await createNote(userId, parsedAnchor, parsedBody)
  if (!row) throw new Error('note anchor not found')
  return row
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
