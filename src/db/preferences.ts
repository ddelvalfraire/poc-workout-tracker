import { eq } from 'drizzle-orm'
import { cache } from 'react'
import { db } from './index'
import { userPreferences } from './schema'
import { DEFAULT_WEIGHT_UNIT, isWeightUnit, type WeightUnit } from '@/lib/units'
import { equipmentForUnit, type Equipment, type StoredEquipment } from '@/lib/equipment'
import { resolveHomeLayout, type HomeLayout, type ResolvedHomeSection } from '@/lib/home/layout'

/**
 * Data access for per-user preferences, always scoped to a WorkOS userId.
 *
 * Like the workouts module, this is the authorization boundary: every query
 * filters by user_id. The `unit` column is loose `text`, so reads guard it with
 * `isWeightUnit` and fall back to the default rather than trusting stored data.
 */

/** The whole preferences row, request-memoized (React cache — per-request
 *  only, never cross-request). getWeightUnit and getHomeLayout both read
 *  through this memo, so home resolves its layout with ZERO queries beyond
 *  the unit read it already made. CONSTRAINT: args must stay cache-key-safe
 *  primitives. */
const getPreferencesRow = cache(async (userId: string) => {
  const [row] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)
  return row ?? null
})

/** Returns the user's weight unit, defaulting to the product default (lb) when
 *  unset or unrecognized. Request-memoized via getPreferencesRow. */
export const getWeightUnit = cache(async (userId: string): Promise<WeightUnit> => {
  const row = await getPreferencesRow(userId)
  return row && isWeightUnit(row.unit) ? row.unit : DEFAULT_WEIGHT_UNIT
})

/** Upserts the user's weight unit. */
export async function setWeightUnit(userId: string, unit: WeightUnit): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, unit })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { unit, updatedAt: new Date() } })
}

/**
 * The user's plate-calculator gear for the active display unit. Stored jsonb
 * is untrusted and unit-native, so `equipmentForUnit` guards the shape and
 * falls back to the unit's defaults on mismatch or absence.
 */
export async function getEquipment(userId: string, unit: WeightUnit): Promise<Equipment> {
  const [row] = await db
    .select({ equipment: userPreferences.equipment })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)
  return equipmentForUnit(row?.equipment ?? null, unit)
}

/** Upserts the user's equipment (validated by the action via parseEquipmentInput). */
export async function setEquipment(userId: string, equipment: StoredEquipment): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, equipment })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { equipment, updatedAt: new Date() },
    })
}

/**
 * The user's bodyweight in canonical kg, or null when never set. The column is
 * numeric but stored data is still guarded: a non-finite or non-positive value
 * reads as null, so bodyweight scoring degrades to the rep fallback instead of
 * producing a nonsense estimated 1RM.
 */
export async function getBodyweightKg(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ bodyweightKg: userPreferences.bodyweightKg })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)
  const value = row?.bodyweightKg ?? null
  return value !== null && Number.isFinite(value) && value > 0 ? value : null
}

/** Widest rest target the app accepts, in seconds — mirrors MAX_REST_SEC in
 *  `lib/program-input.ts` (not imported: db reads must not depend on the input
 *  boundary; the duplication is one number with tests on both sides). */
const MAX_STORED_REST_SEC = 3600

/**
 * The user's default rest target in seconds, or null when never set. Stored
 * data is guarded like `getBodyweightKg`: a non-integer or out-of-range
 * (0..3600) value reads as null, so a corrupt row degrades the rest readout
 * to a plain count-up instead of a nonsense countdown.
 */
export async function getDefaultRestSec(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ defaultRestSec: userPreferences.defaultRestSec })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)
  const value = row?.defaultRestSec ?? null
  return value !== null && Number.isInteger(value) && value >= 0 && value <= MAX_STORED_REST_SEC
    ? value
    : null
}

/** Upserts the user's default rest target (validated by setDefaultRestSecAction);
 *  null clears it, reverting the logger to a count-up-only readout. */
export async function setDefaultRestSec(userId: string, sec: number | null): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, defaultRestSec: sec })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { defaultRestSec: sec, updatedAt: new Date() },
    })
}

/**
 * The lifter's ± step for the weight field, unit-native, or null when never
 * set. Returned RAW — callers resolve it with `resolveWeightStep`, which is
 * also what drops a value the current unit does not offer. Keeping the guard
 * at the caller means the stored number survives a round trip through the
 * other unit and back.
 */
export async function getWeightStep(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ weightStep: userPreferences.weightStep })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)
  const value = row?.weightStep ?? null
  return value !== null && Number.isFinite(value) && value > 0 ? value : null
}

/** Upserts the lifter's ± step (validated by setWeightStepAction); null
 *  reverts to the unit default. */
export async function setWeightStep(userId: string, step: number | null): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, weightStep: step })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { weightStep: step, updatedAt: new Date() },
    })
}

/**
 * Whether the rest-timer surface is enabled at all (readout + targets).
 * Defaults to true — the timer is the feature's normal state — and only a
 * literal stored `false` disables it, so a missing row or corrupt value can
 * never silently kill the feature.
 */
export async function getRestTimerEnabled(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ restTimerEnabled: userPreferences.restTimerEnabled })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)
  return row?.restTimerEnabled !== false
}

/**
 * The user's resolved home section layout. Stored jsonb is untrusted, so
 * `resolveHomeLayout` zod-guards the shape: corrupt, absent, or
 * unknown-version documents degrade to the code-defined default order.
 * Request-memoized THROUGH getPreferencesRow: on home this shares the row
 * the unit read already fetched — zero additional queries.
 */
export const getHomeLayout = cache(async (userId: string): Promise<ResolvedHomeSection[]> => {
  const row = await getPreferencesRow(userId)
  return resolveHomeLayout(row?.homeLayout ?? null)
})

/** Upserts the user's home layout (validated by setHomeLayoutAction); null
 *  clears it — degrade-to-default IS the "Reset to default" path. */
export async function setHomeLayout(userId: string, layout: HomeLayout | null): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, homeLayout: layout })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { homeLayout: layout, updatedAt: new Date() },
    })
}

/** Upserts the rest-timer feature switch (validated by setRestTimerEnabledAction). */
export async function setRestTimerEnabled(userId: string, enabled: boolean): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, restTimerEnabled: enabled })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { restTimerEnabled: enabled, updatedAt: new Date() },
    })
}

/**
 * Whether RPE/RIR effort logging is opted in — the preference arm of the
 * effort-row show rule (sets with a prescribed effort target show the row
 * regardless). Inverse guard of `getRestTimerEnabled`: this feature defaults
 * OFF, so only a literal stored `true` enables it — a missing row or corrupt
 * value can never silently opt a user in.
 */
export async function getRpeLoggingEnabled(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ rpeLoggingEnabled: userPreferences.rpeLoggingEnabled })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)
  return row?.rpeLoggingEnabled === true
}

/** Upserts the RPE/RIR logging switch (validated by setRpeLoggingEnabledAction). */
export async function setRpeLoggingEnabled(userId: string, enabled: boolean): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, rpeLoggingEnabled: enabled })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { rpeLoggingEnabled: enabled, updatedAt: new Date() },
    })
}

