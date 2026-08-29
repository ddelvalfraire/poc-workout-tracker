'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth/auth'
import { getWeightUnit } from '@/db/preferences'
import { archiveGoal, createGoal, deleteGoal } from '@/db/goals'
import { parseGoalInput } from '@/lib/goals/goal-input'
import { checkGoalAchievements } from '@/lib/goals/goals'
import { displayToKg } from '@/lib/units'

/**
 * Server actions for the /goals page. Weight-bearing targets arrive in the
 * user's DISPLAY unit (whatever the input field showed); the stored unit
 * preference is read server-side and converted to canonical kg BEFORE
 * validation — the setBodyweightAction pattern, so a stale client can't
 * convert against the wrong unit. parseGoalInput then enforces kinds and
 * ranges; nothing unvalidated reaches the db layer.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Creates a goal from the untrusted client payload and immediately runs the
 * achievement check for its kind — a goal created already at target gets its
 * honest achievedAt on day one instead of a fake "in progress" state.
 */
export async function createGoalAction(input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  if (!isRecord(input)) throw new Error('invalid goal input')
  const unit = await getWeightUnit(userId)

  // Convert the display-unit target numbers to canonical kg; every other
  // field passes through untouched for parseGoalInput to judge.
  let target = input.target
  if (isRecord(target)) {
    if (input.kind === 'strength' && typeof target.e1rm === 'number') {
      target = { e1rmKg: displayToKg(target.e1rm, unit) }
    } else if (input.kind === 'bodyweight' && typeof target.weight === 'number') {
      target = { weightKg: displayToKg(target.weight, unit), direction: target.direction }
    }
  }
  const parsed = parseGoalInput({ ...input, target })
  const result = await createGoal(userId, parsed)
  // Fails soft inside — a goal that is already met should say so honestly.
  await checkGoalAchievements(userId, [parsed.kind])
  revalidatePath('/goals')
  revalidatePath('/')
  return result
}

// Lowercase-uuid guard, same as the bodyweight/measurement delete actions.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function parseGoalId(id: unknown): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Error('invalid goal id')
  return id
}

/** Soft-hides a goal. Throws when not owned/already archived so the client
 *  surfaces the failure instead of refreshing as if it worked. */
export async function archiveGoalAction(id: unknown): Promise<void> {
  const userId = await requireUserId()
  const archived = await archiveGoal(userId, parseGoalId(id))
  if (!archived) throw new Error('goal not found')
  revalidatePath('/goals')
  revalidatePath('/')
}

/** Hard-deletes a goal (owned rows only), mirroring the archive contract. */
export async function deleteGoalAction(id: unknown): Promise<void> {
  const userId = await requireUserId()
  const deleted = await deleteGoal(userId, parseGoalId(id))
  if (!deleted) throw new Error('goal not found')
  revalidatePath('/goals')
  revalidatePath('/')
}
