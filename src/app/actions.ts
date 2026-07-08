'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { setWeightUnit, setEquipment, setBodyweight, getWeightUnit } from '@/db/preferences'
import { isWeightUnit, displayToKg } from '@/lib/units'
import { parseEquipmentInput } from '@/lib/equipment'

// Sanity ceiling for a stored bodyweight, in canonical kg. Well under the
// numeric(5,2) column max (999.99) so a typo'd extra digit becomes a clear
// validation error instead of a stored absurdity.
const MAX_BODYWEIGHT_KG = 500

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

/**
 * Persists the signed-in user's bodyweight — the load basis for bodyweight
 * logging types. The value arrives in the user's DISPLAY unit (whatever the
 * input field showed); the stored unit preference is read server-side so a
 * stale client can't convert against the wrong unit. Stored in canonical kg,
 * like set weights. Validated at the boundary: finite, positive, and under a
 * 500 kg sanity ceiling.
 */
export async function setBodyweightAction(value: unknown): Promise<void> {
  const userId = await requireUserId()
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('bodyweight must be a positive number')
  }
  const unit = await getWeightUnit(userId)
  const bodyweightKg = displayToKg(value, unit)
  if (bodyweightKg <= 0 || bodyweightKg > MAX_BODYWEIGHT_KG) {
    throw new Error(`bodyweight must be between 0 and ${MAX_BODYWEIGHT_KG} kg`)
  }
  await setBodyweight(userId, bodyweightKg)
  revalidatePath('/', 'layout')
}
