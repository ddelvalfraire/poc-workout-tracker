'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { parseProgramInput } from '@/lib/program-input'
import { getAllExercises } from '@/lib/wger'
import { getRoutineStructure } from '@/lib/wger-templates'
import { mapWgerRoutineToProgram } from '@/lib/wger-template-map'
import { saveProgram } from '@/db/programs'

/**
 * Imports one wger public template into the signed-in user's account as a
 * DRAFT program ("Add to my programs"). Import is ON DEMAND per user — no
 * shared system rows: the routine is re-fetched (Next Data Cache hit), mapped
 * against the live exercise catalog, validated by the same `parseProgramInput`
 * boundary every other create path uses, and saved with the 'wger' actor so
 * `authorActor`/the change log attribute the plan to its source. Unmappable
 * slots were already skip-noted by the mapper; a template with NOTHING
 * mappable throws — the client's try/catch surfaces it inline. Returns the
 * new program id — the client navigates; no redirect() here (the client would
 * mistake NEXT_REDIRECT for a failure, same as every sibling action).
 */
export async function importWgerTemplateAction(templateId: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  if (typeof templateId !== 'number' || !Number.isInteger(templateId) || templateId <= 0) {
    throw new Error('invalid template id')
  }

  const routine = await getRoutineStructure(templateId)
  if (!routine) throw new Error('template not found')

  const exercises = await getAllExercises()
  const catalog = new Map(exercises.map((e) => [e.id, e.name]))
  const mapped = mapWgerRoutineToProgram(routine, catalog)
  if (!mapped) throw new Error('template has no importable days')

  const parsed = parseProgramInput(mapped.input)
  const result = await saveProgram(userId, parsed, 'wger')
  revalidatePath('/programs')
  return result
}
