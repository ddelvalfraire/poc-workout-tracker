import { and, eq } from 'drizzle-orm'
import { db } from './index'
import { pushSubscriptions } from './schema'

/**
 * Data access for web-push subscriptions, scoped to a WorkOS userId like every
 * other db module (the authorization boundary is here, not the route).
 *
 * The endpoint is the subscription's identity at the push service, so the
 * write path upserts on it: a browser re-subscribing (new keys, or a
 * different signed-in user on the same device) updates the existing row
 * rather than duplicating it.
 */

/** The endpoint + encryption keys a push send needs. */
export interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/** Upserts a subscription on its endpoint; the newest user/keys win. */
export async function upsertPushSubscription(
  userId: string,
  input: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        lastSeenAt: new Date(),
      },
    })
}

/** Deletes the user's subscription for one endpoint (ownership-scoped). */
export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
}

/**
 * Deletes a subscription by endpoint alone — the prune path for 404/410 from
 * the push service, where the endpoint itself is the proof it is dead (no
 * user scoping needed or possible: the send loop is server-initiated).
 */
export async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
}

/** All of one user's subscriptions (phone + desktop + …). */
export async function listPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  return db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
}

/** Every distinct user holding at least one subscription — the cron's fan-out set. */
export async function listPushSubscribedUserIds(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
  return rows.map((r) => r.userId)
}
