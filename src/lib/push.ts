import webpush from 'web-push'
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
} from '@/db/push-subscriptions'
import type { PushPayload } from '@/lib/push-payload'

/**
 * Server-side web-push sender. VAPID config is resolved lazily from env on
 * first send (never at import — a missing key must not crash unrelated
 * routes); unconfigured environments report `configured: false` and send
 * nothing, mirroring the getRedis() null pattern.
 *
 * Sends fail SOFT per subscription: one dead phone must not block the
 * desktop's notification. 404/410 mean the push service has retired the
 * endpoint — the row is pruned so the next fan-out skips it.
 */

export interface PushSendResult {
  configured: boolean
  sent: number
  pruned: number
  failed: number
}

// tri-state memo: undefined = not yet resolved, false = resolved unconfigured
let vapidConfigured: boolean | undefined

function ensureConfigured(): boolean {
  if (vapidConfigured !== undefined) return vapidConfigured
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) {
    vapidConfigured = false
    return false
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
  return true
}

/** Test-only escape hatch: re-read env on the next send. */
export function resetPushConfigForTests(): void {
  vapidConfigured = undefined
}

/** HTTP statuses that mean "this endpoint no longer exists" — prune the row. */
const GONE_STATUSES = new Set([404, 410])

function statusOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = (error as { statusCode: unknown }).statusCode
    return typeof code === 'number' ? code : null
  }
  return null
}

/**
 * Sends one payload to every subscription the user holds. Never throws for
 * delivery problems — the result tallies what happened so callers can log
 * or aggregate it.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushSendResult> {
  if (!ensureConfigured()) {
    return { configured: false, sent: 0, pruned: 0, failed: 0 }
  }

  const subscriptions = await listPushSubscriptions(userId)
  const body = JSON.stringify(payload)
  let sent = 0
  let pruned = 0
  let failed = 0

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      )
      sent += 1
    } catch (error: unknown) {
      const status = statusOf(error)
      if (status !== null && GONE_STATUSES.has(status)) {
        // The push service retired this endpoint; the row is dead weight.
        await deletePushSubscriptionByEndpoint(sub.endpoint).catch((pruneError: unknown) => {
          console.error('[push] prune failed', pruneError)
        })
        pruned += 1
      } else {
        console.error('[push] send failed', status ?? error)
        failed += 1
      }
    }
  }

  return { configured: true, sent, pruned, failed }
}
