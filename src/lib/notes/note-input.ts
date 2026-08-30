import { parseNotes } from '../workout/workout-input'

/**
 * Validation boundary for notes-v2 rows (the `notes` table): author whitelist,
 * anchor addressing, and the plain-text body rule. Mirrors the hand-rolled
 * defensive style of `workout-input.ts` — untrusted input either normalizes or
 * throws; nothing is coerced silently.
 *
 * The body is the plain-text tier (the instance dialect): validated through
 * the exported `parseNotes` with a 'note' context so the 2000-char cap and
 * trim rules are byte-identical to the legacy workout/exercise note columns.
 * Markdown stays with exercise-IDENTITY notes (`exercise_notes`) — a
 * different animal, out of scope here.
 */

/** Who authored a note. 'coach' is stored from day one (the model ships the
 *  column) but the coach WRITE path is gated behind the coach surface. */
export const NOTE_AUTHORS = ['user', 'coach'] as const
export type NoteAuthor = (typeof NOTE_AUTHORS)[number]

/** Narrows untrusted input to a NoteAuthor. */
export function isNoteAuthor(value: unknown): value is NoteAuthor {
  return (NOTE_AUTHORS as readonly unknown[]).includes(value)
}

/** The four anchor kinds — exactly one FK is non-null per row (DB CHECK). */
export const NOTE_ANCHOR_KINDS = ['program', 'workout', 'workout_exercise', 'set'] as const
export type NoteAnchorKind = (typeof NOTE_ANCHOR_KINDS)[number]

/** Narrows untrusted input to a NoteAnchorKind. */
export function isNoteAnchorKind(value: unknown): value is NoteAnchorKind {
  return (NOTE_ANCHOR_KINDS as readonly unknown[]).includes(value)
}

/** A note's anchor address: which entity it hangs on. */
export interface NoteAnchor {
  kind: NoteAnchorKind
  id: string
}

/**
 * The small frozen context written ONCE at note-creation for set/exercise
 * anchors — whatever is cheap from the anchor at write time. Never updated:
 * it powers the future "outdated" badge (GitHub outdated-comment semantics)
 * and marks a workout-anchored row as a fallback re-anchor (a re-anchored
 * note keeps its snapshot; a true session note never carries one).
 */
export interface NoteAnchorSnapshot {
  exerciseName?: string
  setNumber?: number
  loadKg?: number | null
  reps?: number | null
  durationSec?: number | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Validates an untrusted anchor address. Lower-cases the id first (an
 * uppercase-uuid URL must not slip past the shape check), rejects unknown
 * kinds and non-uuid ids.
 */
export function parseNoteAnchor(raw: unknown): NoteAnchor {
  if (!raw || typeof raw !== 'object') throw new Error('note anchor must be an object')
  const { kind, id } = raw as Record<string, unknown>
  if (!isNoteAnchorKind(kind)) {
    throw new Error(`note anchor kind must be one of ${NOTE_ANCHOR_KINDS.join(', ')}`)
  }
  if (typeof id !== 'string') throw new Error('note anchor id must be a string')
  const lowered = id.toLowerCase()
  if (!UUID_RE.test(lowered)) throw new Error('note anchor id must be a uuid')
  return { kind, id: lowered }
}

/**
 * Validates a note body: same trim/2000-cap rule as every legacy note column
 * (parseNotes, 'note' context), but REQUIRED — a note with no words is not a
 * note, so blank input throws instead of clearing.
 */
export function parseNoteBody(raw: unknown): string {
  const body = parseNotes(raw, 'note')
  if (body === undefined) throw new Error('note body must not be empty')
  return body
}
