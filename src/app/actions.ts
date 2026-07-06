'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { setWeightUnit, setEquipment } from '@/db/preferences'
import { isWeightUnit } from '@/lib/units'
import { parseEquipmentInput } from '@/lib/equipment'

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

/**
 * Persists the signed-in user's plate-calculator gear (bars + plate
 * denominations, unit-native). Validated at the boundary — the column is
 * loose jsonb and the payload is client data. Revalidates the logger pages
 * so their server-passed equipment prop is fresh next visit.
 */
export async function setEquipmentAction(input: unknown): Promise<void> {
  const userId = await requireUserId()
  const equipment = parseEquipmentInput(input)
  await setEquipment(userId, equipment)
  revalidatePath('/', 'layout')
}
