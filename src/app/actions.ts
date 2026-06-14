'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { setWeightUnit } from '@/db/preferences'
import { isWeightUnit } from '@/lib/units'

/**
 * Persists the signed-in user's weight-unit preference. Validates the untrusted
 * payload at the boundary (the column is loose `text`) and throws on anything
 * but 'kg' | 'lb'. Revalidates the whole layout so every weight display — home,
 * detail, new, edit — re-renders in the new unit.
 */
export async function setWeightUnitAction(unit: unknown): Promise<void> {
  const userId = await requireUserId()
  if (!isWeightUnit(unit)) throw new Error('invalid weight unit')
  await setWeightUnit(userId, unit)
  revalidatePath('/', 'layout')
}
