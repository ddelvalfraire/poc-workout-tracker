'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { parseTemplateInput, parseTemplateMeta } from '@/lib/template-input'
import { deriveTemplateFromWorkout } from '@/lib/workout-template'
import { getWorkoutDetail } from '@/db/workouts'
import {
  createWorkoutTemplate,
  updateWorkoutTemplateMeta,
  deleteWorkoutTemplate,
} from '@/db/workout-templates'

// Same shape guard as /workout/new's `?from`: a malformed id must never reach
// the uuid column (Postgres would 500 with `invalid input syntax for type uuid`).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseUuid(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) throw new Error(`invalid ${field}`)
  return raw.toLowerCase()
}

/**
 * Derives a template from an owned, logged workout and persists it, returning
 * the new template id. The derivation is pure (`deriveTemplateFromWorkout`);
 * its output still passes through `parseTemplateInput` so the DB layer only
 * ever sees boundary-validated input — even our own derivation gets no
 * bypass. Throws when the workout isn't owned or nothing is derivable (every
 * exercise skipped); the client surfaces the message inline.
 */
export async function saveWorkoutAsTemplateAction(workoutId: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const workout = await getWorkoutDetail(userId, parseUuid(workoutId, 'workout id'))
  if (!workout) throw new Error('workout not found')
  const derived = deriveTemplateFromWorkout(workout)
  if (!derived) throw new Error('nothing to save — every exercise was skipped')
  const result = await createWorkoutTemplate(userId, parseTemplateInput(derived))
  revalidatePath('/templates')
  return result
}

/**
 * Validates and applies a metadata edit (name/description/icon) to an owned
 * template. A missing result means not owned (or concurrently deleted) — we
 * throw so the client's try/catch surfaces an inline error.
 */
export async function updateTemplateMetaAction(id: unknown, input: unknown): Promise<void> {
  const userId = await requireUserId()
  const templateId = parseUuid(id, 'template id')
  const meta = parseTemplateMeta(input)
  const result = await updateWorkoutTemplateMeta(userId, templateId, meta)
  if (!result) throw new Error('template not found')
  revalidatePath('/templates')
  revalidatePath(`/templates/${templateId}`)
}

/**
 * Deletes an owned template (exercises cascade). Returns void — the client
 * navigates after; no redirect() here (the client try/catch would mistake
 * NEXT_REDIRECT for a failure), mirroring deleteWorkoutAction.
 */
export async function deleteTemplateAction(id: unknown): Promise<void> {
  const userId = await requireUserId()
  const [deleted] = await deleteWorkoutTemplate(userId, parseUuid(id, 'template id'))
  if (!deleted) throw new Error('template not found')
  revalidatePath('/templates')
}
