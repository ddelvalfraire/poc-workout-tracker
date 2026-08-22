import { and, eq, sql } from 'drizzle-orm'
import { db } from './index'
import { usageCounters } from './schema'

/**
 * Metered-usage counters. The whole double-spend problem is solved by a
 * single atomic statement: "increment if under the limit, else refuse",
 * evaluated under the row lock so concurrent requests (double-click, two
 * tabs, a retry) serialize on the row and can never both pass the cap. No
 * check-then-act in application code — that races under serverless
 * concurrency. See the metering decision record.
 *
 * The limit is passed in (resolved from the caller's tier), never stored on
 * the row.
 */

export interface ConsumeResult {
  /** True when a unit was consumed; false when the cap was already reached. */
  allowed: boolean
  /** Units used AFTER this call (== limit when denied). */
  used: number
  limit: number
}

/**
 * Consume one unit of `meter` for `userId` in `periodKey`, if under `limit`.
 * Atomic: the INSERT seeds the first unit, and the ON CONFLICT update only
 * increments while `used < limit`, so a returned row means "consumed" and an
 * empty result means "cap reached" — with no separate read to race against.
 */
export async function consumeUsage(
  userId: string,
  meter: string,
  periodKey: string,
  limit: number,
): Promise<ConsumeResult> {
  // A non-positive limit grants nothing; the INSERT path is not gated by the
  // update's WHERE, so guard it here rather than seeding a forbidden unit.
  if (limit <= 0) return { allowed: false, used: 0, limit }

  const rows = await db
    .insert(usageCounters)
    .values({ userId, meter, periodKey, used: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.meter, usageCounters.periodKey],
      set: { used: sql`${usageCounters.used} + 1`, updatedAt: sql`now()` },
      setWhere: sql`${usageCounters.used} < ${limit}`,
    })
    .returning({ used: usageCounters.used })

  if (rows.length === 0) return { allowed: false, used: limit, limit }
  return { allowed: true, used: rows[0].used, limit }
}

/** How much of a meter a user has used (0 if never). Read-only — for UI and
 *  analytics, never for the cap decision (that goes through consumeUsage). */
export async function getUsage(userId: string, meter: string, periodKey: string): Promise<number> {
  const [row] = await db
    .select({ used: usageCounters.used })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.userId, userId),
        eq(usageCounters.meter, meter),
        eq(usageCounters.periodKey, periodKey),
      ),
    )
    .limit(1)
  return row?.used ?? 0
}
