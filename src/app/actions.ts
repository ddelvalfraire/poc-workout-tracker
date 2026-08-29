'use server'

import { revalidatePath } from 'next/cache'
import { signOut } from '@workos-inc/authkit-nextjs'
import { requireUserId } from '@/lib/auth'
import {
  setWeightUnit,
  setEquipment,
  setDefaultRestSec,
  setWeightStep,
  setRestTimerEnabled,
  setHomeLayout,
  setRpeLoggingEnabled,
  getWeightUnit,
} from '@/db/preferences'
import { parseHomeLayoutInput } from '@/lib/home/layout'
import { WEIGHT_STEP_CHOICES } from '@/lib/format'
import { logBodyweight, deleteBodyweightLog } from '@/db/bodyweight'
import { checkGoalAchievements } from '@/lib/goals'
import { logMeasurement, deleteMeasurement } from '@/db/body-measurements'
import { isMeasurementSite } from '@/lib/measurement-sites'
import { isWeightUnit, displayToKg, displayToCm, lengthUnitFor } from '@/lib/units'
import { parseEquipmentInput } from '@/lib/exercises/equipment'
import { MAX_REST_SEC } from '@/lib/program-input'

// Sanity bounds for a stored bodyweight, in canonical kg. The ceiling sits
// well under the numeric(5,2) column max (999.99) so a typo'd extra digit
// becomes a clear validation error instead of a stored absurdity. The floor
// is the column's own precision step: anything smaller would round to 0.00
// on write and scoring would read a zero bodyweight.
const MIN_BODYWEIGHT_KG = 0.01
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
 * scoring reads) to the freshest log — so a settings edit and a /body
 * quick log are the same write path.
 */
export async function setBodyweightAction(value: unknown): Promise<void> {
  const userId = await requireUserId()
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('bodyweight must be a positive number')
  }
  const unit = await getWeightUnit(userId)
  const bodyweightKg = displayToKg(value, unit)
  if (bodyweightKg < MIN_BODYWEIGHT_KG || bodyweightKg > MAX_BODYWEIGHT_KG) {
    throw new Error(
      `bodyweight must be between ${MIN_BODYWEIGHT_KG} and ${MAX_BODYWEIGHT_KG} kg`,
    )
  }
  await logBodyweight(userId, bodyweightKg)
  // A weigh-in can complete a bodyweight goal — checked on the same seam as
  // the write, fails soft inside (never fails the log).
  await checkGoalAchievements(userId, ['bodyweight'])
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
 * Logs one tape measurement from the /body page. The value arrives in the
 * user's DISPLAY length unit — inferred server-side from the stored weight
 * unit (lb → in, kg → cm; one preference governs both), so a stale client
 * can't convert against the wrong unit. Stored in canonical cm. The site
 * whitelist and the 10–300 cm plausibility band are enforced in the data
 * layer; this boundary guards the shape (a finite positive number, a string
 * site) so the db error messages stay about semantics, not types.
 */
export async function logMeasurementAction(site: unknown, value: unknown): Promise<void> {
  const userId = await requireUserId()
  if (!isMeasurementSite(site)) throw new Error('invalid measurement site')
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('measurement must be a positive number')
  }
  const unit = lengthUnitFor(await getWeightUnit(userId))
  await logMeasurement(userId, site, displayToCm(value, unit))
  revalidatePath('/body')
}

/**
 * Deletes one owned measurement. A missing result means the row isn't owned
 * or is already gone — throw so the client shows the failure instead of
 * refreshing as if it worked. Same uuid guard as the bodyweight delete.
 */
export async function deleteMeasurementAction(id: unknown): Promise<void> {
  const userId = await requireUserId()
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new Error('invalid measurement id')
  }
  const deleted = await deleteMeasurement(userId, id)
  if (!deleted) throw new Error('measurement not found')
  revalidatePath('/body')
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

/**
 * Persists the lifter's ± step for the weight field. Boundary-validated
 * against the CURRENT unit's choices rather than a range: the picker offers a
 * fixed list per unit, so anything else is either a stale client or a forged
 * call. null clears it back to the unit default.
 */
export async function setWeightStepAction(step: unknown): Promise<void> {
  const userId = await requireUserId()
  if (step !== null) {
    const unit = await getWeightUnit(userId)
    if (typeof step !== 'number' || !WEIGHT_STEP_CHOICES[unit].includes(step)) {
      throw new Error(`weight step must be null or one of ${WEIGHT_STEP_CHOICES[unit].join(', ')} ${unit}`)
    }
  }
  await setWeightStep(userId, step)
  revalidatePath('/', 'layout')
}

/**
 * Persists the user's home section layout (the settings/home editor writes
 * the FULL document per interaction). `null` resets to the code-defined
 * default — degrade-to-default IS the reset path. Non-null payloads are
 * boundary-validated: unknown kinds, duplicates, and missing kinds all
 * reject before any write.
 */
export async function setHomeLayoutAction(layout: unknown): Promise<void> {
  const userId = await requireUserId()
  const doc = layout === null ? null : parseHomeLayoutInput(layout)
  await setHomeLayout(userId, doc)
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

/** Flips opt-in RPE/RIR effort logging on/off (settings toggle). */
export async function setRpeLoggingEnabledAction(enabled: unknown): Promise<void> {
  const userId = await requireUserId()
  if (typeof enabled !== 'boolean') {
    throw new Error('rpe logging flag must be a boolean')
  }
  await setRpeLoggingEnabled(userId, enabled)
  revalidatePath('/', 'layout')
}

/**
 * Ends the session and sends the user to AuthKit's logout, which clears the
 * WorkOS session before returning them to the app signed out. Lives here
 * rather than beside the component so the button can stay a client component
 * — a `'use server'` module is the only thing a client form action may call.
 */
export async function signOutAction(): Promise<void> {
  await signOut()
}

