'use server'

import { revalidatePath } from 'next/cache'
import { ZodError } from 'zod'
import { requireUserId } from '@/lib/auth/auth'
import {
  customExerciseInputSchema,
  type CustomExerciseInput,
  type ExerciseSource,
} from '@/lib/exercises/custom-exercise-input'
import { createCustomExercise, updateCustomExercise } from '@/db/custom-exercises'
import { parseExerciseNoteInput } from '@/lib/notes/exercise-note-input'
import { upsertExerciseNote, deleteExerciseNote } from '@/db/exercise-notes'

/**
 * Action boundary for the user's custom exercise definitions (create from the
 * picker, edit from the detail page). Validation runs here on the server —
 * independent of any client checks — via the same zod schema Phase 1 shipped;
 * ownership is enforced by the db layer's user-scoped writes.
 */

/** The subset the UI needs back after a write. */
export interface CustomExerciseResult {
  id: number
  name: string
  category: string
  muscles: string[]
  musclesSecondary: string[]
}

/** Postgres unique-violation (the per-user name guard) → a human sentence. */
function translateDuplicateName(error: unknown): never {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('custom_exercises_user_name_unique')) {
    throw new Error('You already have a custom exercise with this name.')
  }
  throw error instanceof Error ? error : new Error('saving the custom exercise failed')
}

/** Schema parse whose failure reads like a sentence, not serialized issues —
 *  the picker/editor render err.message directly. */
function parseCustomExerciseInput(input: unknown): CustomExerciseInput {
  try {
    return customExerciseInputSchema.parse(input)
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const issue = error.issues[0]
      const where = issue?.path.join('.') || 'input'
      throw new Error(`Invalid ${where}: ${issue?.message ?? 'check the fields and try again'}`)
    }
    throw error
  }
}

export async function createCustomExerciseAction(input: unknown): Promise<CustomExerciseResult> {
  const userId = await requireUserId()
  const parsed = parseCustomExerciseInput(input)
  try {
    const row = await createCustomExercise(userId, parsed)
    revalidatePath('/exercises')
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      muscles: row.muscles ?? [],
      musclesSecondary: row.musclesSecondary ?? [],
    }
  } catch (error: unknown) {
    translateDuplicateName(error)
  }
}

/**
 * Full-field update of an owned custom exercise. A missing result means the
 * exercise isn't owned (or doesn't exist) — thrown so the client's try/catch
 * surfaces it, mirroring updateWorkoutAction's ownership handling.
 */
export async function updateCustomExerciseAction(
  id: unknown,
  input: unknown,
): Promise<CustomExerciseResult> {
  const userId = await requireUserId()
  if (!Number.isInteger(id) || (id as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  const parsed = parseCustomExerciseInput(input)
  let row: Awaited<ReturnType<typeof updateCustomExercise>>
  try {
    row = await updateCustomExercise(userId, id as number, parsed)
  } catch (error: unknown) {
    translateDuplicateName(error)
  }
  // Outside the try: not-found is ownership, not a name collision — it must
  // never ride through the duplicate-name translator.
  if (!row) throw new Error('custom exercise not found')
  revalidatePath('/exercises')
  revalidatePath(`/exercises/custom/${id}`)
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    muscles: row.muscles ?? [],
    musclesSecondary: row.musclesSecondary ?? [],
  }
}

/** Trailing source param shared by the note actions, mirroring the workout
 *  actions' whitelist: a typo'd source must never touch the wrong identity. */
function parseNoteSource(source: unknown): ExerciseSource {
  if (source === 'wger' || source === 'custom') return source
  throw new Error('invalid exercise source')
}

/**
 * Creates or replaces the caller's identity note for one exercise (the
 * seat-pin note). Validation runs here on the server via the zod boundary;
 * ownership is the db layer's user-scoped upsert. Returns the stored note so
 * optimistic UI can reconcile.
 */
export async function upsertExerciseNoteAction(
  source: unknown,
  exerciseId: unknown,
  input: unknown,
): Promise<{ body: string; pinned: boolean }> {
  const userId = await requireUserId()
  const parsedSource = parseNoteSource(source)
  if (!Number.isInteger(exerciseId) || (exerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  const parsed = parseExerciseNoteInput(input)
  const row = await upsertExerciseNote(userId, parsedSource, exerciseId as number, parsed)
  revalidatePath(`/exercises/${parsedSource}/${exerciseId}`)
  return { body: row.body, pinned: row.pinned }
}

/** Deletes the caller's identity note; missing/not-owned notes throw so the
 *  client's try/catch surfaces it (updateWorkoutAction's ownership handling). */
export async function deleteExerciseNoteAction(
  source: unknown,
  exerciseId: unknown,
): Promise<void> {
  const userId = await requireUserId()
  const parsedSource = parseNoteSource(source)
  if (!Number.isInteger(exerciseId) || (exerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  const deleted = await deleteExerciseNote(userId, parsedSource, exerciseId as number)
  if (!deleted) throw new Error('note not found')
  revalidatePath(`/exercises/${parsedSource}/${exerciseId}`)
}
