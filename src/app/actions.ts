'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import {
  setWeightUnit,
  setEquipment,
  setDefaultRestSec,
  setRestTimerEnabled,
  getWeightUnit,
} from '@/db/preferences'
import { logBodyweight, deleteBodyweightLog } from '@/db/bodyweight'
import { isWeightUnit, displayToKg } from '@/lib/units'
import { parseEquipmentInput } from '@/lib/equipment'
import { MAX_REST_SEC } from '@/lib/program-input'

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
 *
 * Every set is a weigh-in: it appends a `bodyweight_logs` row (history) and
 * the data layer syncs `user_preferences.bodyweight_kg` (the current value
 * scoring reads) to the freshest log — so a settings edit and a /bodyweight
 * quick log are the same write path.
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
  await logBodyweight(userId, bodyweightKg)
  revalidatePath('/', 'layout')
}

// Lowercase-uuid shape for a log row id — same guard style as the workout
// draft keys: keeps arbitrary strings out of the delete path before it ever
// reaches SQL (uuids from our own pages arrive lowercase already).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Deletes one owned weigh-in. The data layer resyncs the current bodyweight
 * to the freshest remaining entry (or clears it when none are left). A
 * missing result means the row isn't owned or is already gone — throw so the
 * client shows the failure instead of refreshing as if it worked.
 */
export async function deleteBodyweightLogAction(id: unknown): Promise<void> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new Error('invalid bodyweight log id')
  }
  const deleted = await deleteBodyweightLog(userId, id)
  if (!deleted) throw new Error('bodyweight entry not found')
  revalidatePath('/', 'layout')
}

/**
 * Persists the signed-in user's default rest target in seconds — the fallback
 * the logger counts down when the completed set has no per-set plan restSec.
 * `null` clears the target (count-up only). Validated at the boundary: null or
 * an integer 0..3600, the same MAX_REST_SEC bound the program schema enforces,
 * so a plan rest and the session default can never disagree on validity.
 * Revalidates the layout so the logger pages' server-passed prop is fresh.
 */
export async function setDefaultRestSecAction(sec: unknown): Promise<void> {
  const userId = await requireUserId()
  if (sec !== null && (typeof sec !== 'number' || !Number.isInteger(sec) || sec < 0 || sec > MAX_REST_SEC)) {
    throw new Error(`rest target must be null or an integer between 0 and ${MAX_REST_SEC} seconds`)
  }
  await setDefaultRestSec(userId, sec)
  revalidatePath('/', 'layout')
}

/** Flips the whole rest-timer surface on/off (settings toggle). */
export async function setRestTimerEnabledAction(enabled: unknown): Promise<void> {
  const userId = await requireUserId()
  if (typeof enabled !== 'boolean') {
    throw new Error('rest timer flag must be a boolean')
  }
  await setRestTimerEnabled(userId, enabled)
  revalidatePath('/', 'layout')
}
