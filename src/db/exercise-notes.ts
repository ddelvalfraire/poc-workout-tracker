import { and, eq, or } from 'drizzle-orm'
import type { ExerciseSource } from '@/lib/exercises/custom-exercise-input'
import type { ExerciseNoteInput } from '@/lib/notes/exercise-note-input'
import { db } from './index'
import { exerciseNotes } from './schema'

/**
 * Data access for exercise-IDENTITY notes, always scoped to a WorkOS userId.
 *
 * Like `db/custom-exercises.ts`, this module is the authorization boundary:
 * every query filters by `user_id`, and route/MCP handlers must go through
 * these helpers rather than touching the table directly. Identity is the
 * composite (source, exerciseId) — the app-wide discriminator.
 *
 * Callers pass already-parsed `ExerciseNoteInput` — validation happens at the
 * boundary (`parseExerciseNoteInput`), same as custom exercises. `body` is a
 * markdown string; editor JSON is never persisted.
 */

/** Row type for consumers (surfaces render body + pinned; updatedAt for staleness). */
export type ExerciseNoteRow = typeof exerciseNotes.$inferSelect

/** The user's note for one exercise identity, or null. */
export async function getExerciseNote(
  userId: string,
  source: ExerciseSource,
  exerciseId: number,
): Promise<ExerciseNoteRow | null> {
  const [row] = await db
    .select()
    .from(exerciseNotes)
    .where(
      and(
        eq(exerciseNotes.userId, userId),
        eq(exerciseNotes.source, source),
        eq(exerciseNotes.exerciseId, exerciseId),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Creates or replaces the user's note for the identity (the UNIQUE
 * (user_id, source, exercise_id) constraint keys the upsert). Full-field set
 * on conflict — the note is one value, not a patch surface.
 */
export async function upsertExerciseNote(
  userId: string,
  source: ExerciseSource,
  exerciseId: number,
  input: ExerciseNoteInput,
): Promise<ExerciseNoteRow> {
  const [row] = await db
    .insert(exerciseNotes)
    .values({ userId, source, exerciseId, body: input.body, pinned: input.pinned })
    .onConflictDoUpdate({
      target: [exerciseNotes.userId, exerciseNotes.source, exerciseNotes.exerciseId],
      set: { body: input.body, pinned: input.pinned, updatedAt: new Date() },
    })
    .returning()
  // An upsert either returns the row or throws; guard the impossible empty
  // result so it fails loudly here instead of as a confusing undefined later.
  if (!row) throw new Error('upsertExerciseNote: upsert returned no row')
  return row
}

/**
 * Deletes the user's note for the identity. Returns false when the user has
 * no such note (which includes "someone else's note" — the where is
 * owner-scoped, so cross-user deletion is impossible by construction).
 */
export async function deleteExerciseNote(
  userId: string,
  source: ExerciseSource,
  exerciseId: number,
): Promise<boolean> {
  const rows = await db
    .delete(exerciseNotes)
    .where(
      and(
        eq(exerciseNotes.userId, userId),
        eq(exerciseNotes.source, source),
        eq(exerciseNotes.exerciseId, exerciseId),
      ),
    )
    .returning({ id: exerciseNotes.id })
  return rows.length > 0
}

/**
 * Batched read for a set of identities (the get_workout MCP enrichment): one
 * query, rows keyed by the caller on (source, exerciseId). Empty refs short-
 * circuits — no query.
 */
export async function listExerciseNotesFor(
  userId: string,
  refs: { source: ExerciseSource; exerciseId: number }[],
): Promise<ExerciseNoteRow[]> {
  if (refs.length === 0) return []
  return db
    .select()
    .from(exerciseNotes)
    .where(
      and(
        eq(exerciseNotes.userId, userId),
        or(
          ...refs.map((ref) =>
            and(eq(exerciseNotes.source, ref.source), eq(exerciseNotes.exerciseId, ref.exerciseId)),
          ),
        ),
      ),
    )
}
