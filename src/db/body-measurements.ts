import { and, desc, eq } from 'drizzle-orm'
import { db } from './index'
import { bodyMeasurements } from './schema'
import { isMeasurementSite, type MeasurementSite } from '@/lib/body/measurement-sites'

/**
 * Data access for tape measurements, always scoped to a WorkOS userId — the
 * same authorization-boundary contract as db/bodyweight.ts. Unlike bodyweight
 * there is NO denormalized current value to resync (nothing scores off a
 * girth), so writes are single statements, not transactions.
 */

// Human-plausibility band for a stored girth, in canonical cm. The ceiling
// sits under the numeric(5,2) column max (999.99) so a typo'd extra digit is
// a validation error, not a stored absurdity; the floor rejects values that
// are obviously a slipped decimal.
export const MIN_MEASUREMENT_CM = 10
export const MAX_MEASUREMENT_CM = 300

/** One measurement row, value in canonical cm. */
export interface BodyMeasurement {
  id: string
  measuredAt: Date
  site: MeasurementSite
  valueCm: number
}

/**
 * Inserts one site reading. Validates here (not only at the action boundary)
 * because `site` and `value_cm` are loose text/numeric columns — the whitelist
 * and range are the schema this table actually promises. `measuredAt` defaults
 * to now via the column default; passing a date backdates the entry.
 */
export async function logMeasurement(
  userId: string,
  site: MeasurementSite,
  valueCm: number,
  measuredAt?: Date,
): Promise<{ id: string }> {
  if (!isMeasurementSite(site)) throw new Error('invalid measurement site')
  if (
    !Number.isFinite(valueCm) ||
    valueCm < MIN_MEASUREMENT_CM ||
    valueCm > MAX_MEASUREMENT_CM
  ) {
    throw new Error(
      `measurement must be between ${MIN_MEASUREMENT_CM} and ${MAX_MEASUREMENT_CM} cm`,
    )
  }
  const [inserted] = await db
    .insert(bodyMeasurements)
    .values({ userId, site, valueCm, ...(measuredAt !== undefined ? { measuredAt } : {}) })
    .returning({ id: bodyMeasurements.id })
  return inserted
}

/**
 * Lists a user's measurements, freshest first — optionally one site only.
 * The default cap (120) covers ~15 full-body check-ins across all 8 sites,
 * or months of tracking a single site; plenty for the trend surface.
 */
export async function listMeasurements(
  userId: string,
  options: { site?: MeasurementSite; limit?: number } = {},
): Promise<BodyMeasurement[]> {
  const { site, limit = 120 } = options
  return db
    .select({
      id: bodyMeasurements.id,
      measuredAt: bodyMeasurements.measuredAt,
      site: bodyMeasurements.site,
      valueCm: bodyMeasurements.valueCm,
    })
    .from(bodyMeasurements)
    .where(
      site !== undefined
        ? and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.site, site))
        : eq(bodyMeasurements.userId, userId),
    )
    .orderBy(desc(bodyMeasurements.measuredAt))
    .limit(limit)
}

/**
 * Deletes one measurement, gated on ownership (the `delete ... returning`
 * proves it). Returns null when the row isn't owned or is already gone.
 */
export async function deleteMeasurement(
  userId: string,
  id: string,
): Promise<{ id: string } | null> {
  const [deleted] = await db
    .delete(bodyMeasurements)
    .where(and(eq(bodyMeasurements.id, id), eq(bodyMeasurements.userId, userId)))
    .returning({ id: bodyMeasurements.id })
  return deleted ?? null
}
