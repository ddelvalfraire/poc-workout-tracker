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
  if (!Number.isInteger(wgerExerciseId)) throw new Error('invalid exercise id')
  const exclude = typeof excludeWorkoutId === 'string' ? excludeWorkoutId : undefined
  return getLastPerformance(userId, wgerExerciseId as number, exclude)
}
