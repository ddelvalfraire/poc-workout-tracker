'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { parseProgramInput, statusSchema } from '@/lib/program-input'
import {
  saveProgram,
  updateProgram,
  deleteProgram,
  setProgramStatus,
  instantiateProgramDay,
} from '@/db/programs'

/**
 * Validates and persists a new program for the signed-in user, returning its id.
 *
 * Validation runs here on the server — independent of any client-side checks —
 * so malformed input is rejected even if the browser sends it directly. A throw
 * (auth redirect, validation failure, or DB error) surfaces to the caller as a
 * rejected action; the client component is expected to `try/catch` it.
 */
export async function saveProgramAction(input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseProgramInput(input)
  const result = await saveProgram(userId, parsed)
  revalidatePath('/programs')
  return result
}

/**
 * Validates and applies a full-replace edit to an owned program, returning its
 * id. A missing result means the program isn't owned (or was concurrently
 * deleted); we throw so the client's try/catch surfaces an inline error.
 *
 * `updateProgram` deletes and re-inserts the whole day/exercise/set tree, so the
 * builder's draft must round-trip EVERYTHING (progression/technique JSONB
 * included — `detailToProgramDraft`/`draftToProgramInput` carry them through).
 * One documented loss: per-week set OVERRIDES live on the replaced set rows and
 * are not re-inserted, so an edit here drops them (they remain MCP-only).
 */
export async function updateProgramAction(id: string, input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseProgramInput(input)
  const result = await updateProgram(userId, id, parsed)
  if (!result) throw new Error('program not found')
  revalidatePath('/programs')
  revalidatePath(`/programs/${id}`)
  return result
}

/**
 * Deletes an owned program (children cascade). Returns void — the client
 * navigates to the list after; we must NOT redirect() here, as the client wraps
 * the call in try/catch and would mistake NEXT_REDIRECT for a failure.
 *
 * A missing result means the program isn't owned (or was already deleted); we
 * throw so the client surfaces an error rather than navigating away as if it
 * had worked — mirroring deleteWorkoutAction's ownership handling.
 */
export async function deleteProgramAction(id: string): Promise<void> {
  const userId = await requireUserId()
  const [deleted] = await deleteProgram(userId, id)
  if (!deleted) throw new Error('program not found')
  revalidatePath('/programs')
}

/**
 * Updates only a program's lifecycle status (draft/active/archived), validated
 * here against the same enum the schema uses. A null result means the program
 * isn't owned; we throw for the client's try/catch.
 */
export async function setProgramStatusAction(id: string, status: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = statusSchema.parse(status)
  const result = await setProgramStatus(userId, id, parsed)
  if (!result) throw new Error('program not found')
  revalidatePath('/programs')
  revalidatePath(`/programs/${id}`)
  return result
}

/**
 * Instantiates a program day into a new workout with engine-derived targets,
 * auto-deriving the week from the program's own history (explicit weeks stay
 * MCP-only). Returns the new workout id — the client navigates to it; no
 * redirect() here for the same try/catch reason as above. Null means the day
 * isn't found or its program isn't owned.
 */
export async function startProgramDayAction(
  programDayId: unknown,
): Promise<{ workoutId: string; week: number }> {
  const userId = await requireUserId()
  if (typeof programDayId !== 'string' || programDayId.length === 0) {
    throw new Error('invalid program day id')
  }
  const result = await instantiateProgramDay(userId, programDayId)
  if (!result) throw new Error('program day not found')
  revalidatePath('/') // the new workout appears in the home history list
  return { workoutId: result.id, week: result.week }
}
