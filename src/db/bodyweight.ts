import { and, desc, eq } from 'drizzle-orm'
import { db } from './index'
import { bodyweightLogs, userPreferences } from './schema'

/**
 * Data access for bodyweight logs, always scoped to a Clerk userId.
 *
 * Like the workouts module, this is the authorization boundary: every query
 * filters by user_id. The table is the measurement HISTORY;
 * `user_preferences.bodyweight_kg` stays the denormalized CURRENT value that
 * e1RM scoring reads (one read path, on purpose). Every write here resyncs
 * that current value to the freshest log row — the simplest honest rule that
 * keeps a backdated entry from clobbering the current weight: we never copy
 * the just-written value, we re-derive from max(weighed_at) after the write.
 */

/** One weigh-in row, weight in canonical kg. */
export interface BodyweightLog {
  id: string
  weighedAt: Date
  weightKg: number
}

/** The transaction handle, lifted from the callback signature (no internal import). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Re-derives `user_preferences.bodyweight_kg` from the freshest remaining log
 * row (by weighed_at) — or clears it to null when the user has no logs left.
 * Runs inside the caller's transaction so a log write and its prefs sync
 * commit (or roll back) together.
 */
async function syncCurrentBodyweight(tx: Tx, userId: string): Promise<void> {
  const [freshest] = await tx
    .select({ weightKg: bodyweightLogs.weightKg })
    .from(bodyweightLogs)
    .where(eq(bodyweightLogs.userId, userId))
    .orderBy(desc(bodyweightLogs.weighedAt))
    .limit(1)
  const bodyweightKg = freshest?.weightKg ?? null
  await tx
    .insert(userPreferences)
    .values({ userId, bodyweightKg })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { bodyweightKg, updatedAt: new Date() },
    })
}

/**
 * Inserts a weigh-in (validated by setBodyweightAction — kg, positive, under
 * the sanity ceiling) and resyncs the denormalized current value. `weighedAt`
 * defaults to now via the column default; passing an explicit date backdates
 * the entry, and the resync-from-freshest rule ensures a backdated entry
 * never overwrites a newer measurement in user_preferences.
 */
export async function logBodyweight(
  userId: string,
  weightKg: number,
  weighedAt?: Date,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(bodyweightLogs)
      .values({ userId, weightKg, ...(weighedAt !== undefined ? { weighedAt } : {}) })
      .returning({ id: bodyweightLogs.id })
    await syncCurrentBodyweight(tx, userId)
    return inserted
  })
}

/** Lists a user's weigh-ins, freshest first. The default cap (60) covers
 *  roughly two months of daily logging — plenty for the trend surface. */
export async function listBodyweightLogs(userId: string, limit = 60): Promise<BodyweightLog[]> {
  return db
    .select({
      id: bodyweightLogs.id,
      weighedAt: bodyweightLogs.weighedAt,
      weightKg: bodyweightLogs.weightKg,
    })
    .from(bodyweightLogs)
    .where(eq(bodyweightLogs.userId, userId))
    .orderBy(desc(bodyweightLogs.weighedAt))
    .limit(limit)
}

/**
 * Deletes one weigh-in, gated on ownership (the `delete ... returning` proves
 * it), then resyncs the current value to the freshest REMAINING row — or to
 * null when the last entry was just removed, degrading bodyweight scoring
 * back to the rep fallback. Returns null when the row isn't owned or is gone.
 */
export async function deleteBodyweightLog(
  userId: string,
  id: string,
): Promise<{ id: string } | null> {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(bodyweightLogs)
      .where(and(eq(bodyweightLogs.id, id), eq(bodyweightLogs.userId, userId)))
      .returning({ id: bodyweightLogs.id })
    if (!deleted) return null
    await syncCurrentBodyweight(tx, userId)
    return deleted
  })
}
