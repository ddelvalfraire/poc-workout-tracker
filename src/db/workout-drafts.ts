import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from './index'
import { workoutDrafts } from './schema'

/**
 * Data access for cross-device workout drafts, always scoped to a Clerk
 * userId. Like `db/preferences.ts`, this module is the authorization
 * boundary: every query filters by `user_id`, and the composite (user_id,
 * key) primary key makes a draft addressable only through its owner.
 *
 * `payload` is stored as opaque jsonb — the Server Action validates its
 * structure on write and the client codec re-validates on read, so this layer
 * never interprets it. TTL is enforced by the read action against
 * `updated_at`, not here.
 */

/** Returns the draft row for a logging surface, or undefined. */
export async function getWorkoutDraft(
  userId: string,
  key: string,
): Promise<{ payload: unknown; updatedAt: Date } | undefined> {
  const [row] = await db
    .select({ payload: workoutDrafts.payload, updatedAt: workoutDrafts.updatedAt })
    .from(workoutDrafts)
    .where(and(eq(workoutDrafts.userId, userId), eq(workoutDrafts.key, key)))
    .limit(1)
  return row
}

// A user legitimately has at most a handful of surfaces (one 'new' + open
// edits); the cap only exists to stop a hostile client from minting unbounded
// rows under arbitrary uuid keys.
const MAX_DRAFTS_PER_USER = 20

/**
 * Upserts the draft for a logging surface (last writer wins across devices),
 * then prunes the user's oldest drafts beyond the per-user cap.
 */
export async function putWorkoutDraft(userId: string, key: string, payload: unknown): Promise<void> {
  await db
    .insert(workoutDrafts)
    .values({ userId, key, payload })
    .onConflictDoUpdate({
      target: [workoutDrafts.userId, workoutDrafts.key],
      set: { payload, updatedAt: new Date() },
    })

  const rows = await db
    .select({ key: workoutDrafts.key })
    .from(workoutDrafts)
    .where(eq(workoutDrafts.userId, userId))
    .orderBy(desc(workoutDrafts.updatedAt))
  const excess = rows.slice(MAX_DRAFTS_PER_USER).map((row) => row.key)
  if (excess.length > 0) {
    await db
      .delete(workoutDrafts)
      .where(and(eq(workoutDrafts.userId, userId), inArray(workoutDrafts.key, excess)))
  }
}

/** Deletes the draft for a logging surface (after save, on clear, or TTL expiry). */
export async function deleteWorkoutDraft(userId: string, key: string): Promise<void> {
  await db
    .delete(workoutDrafts)
    .where(and(eq(workoutDrafts.userId, userId), eq(workoutDrafts.key, key)))
}
