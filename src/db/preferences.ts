import { eq } from 'drizzle-orm'
import { db } from './index'
import { userPreferences } from './schema'
import { DEFAULT_WEIGHT_UNIT, isWeightUnit, type WeightUnit } from '@/lib/units'
import { equipmentForUnit, type Equipment, type StoredEquipment } from '@/lib/equipment'

/**
 * Data access for per-user preferences, always scoped to a Clerk userId.
 *
 * Like the workouts module, this is the authorization boundary: every query
 * filters by user_id. The `unit` column is loose `text`, so reads guard it with
 * `isWeightUnit` and fall back to the default rather than trusting stored data.
 */

/** Returns the user's weight unit, defaulting to the product default (lb) when unset or unrecognized. */
export async function getWeightUnit(userId: string): Promise<WeightUnit> {
  const [row] = await db
    .select({ unit: userPreferences.unit })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)
  return row && isWeightUnit(row.unit) ? row.unit : DEFAULT_WEIGHT_UNIT
}

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

/** Upserts the user's bodyweight in kg (validated by setBodyweightAction). */
export async function setBodyweight(userId: string, bodyweightKg: number): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, bodyweightKg })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { bodyweightKg, updatedAt: new Date() },
    })
}
