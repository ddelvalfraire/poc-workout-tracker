import 'server-only'
import { getWorkOS } from '@workos-inc/authkit-nextjs'
import {
  recordConsent,
  markDownstreamAction,
  pseudonymizeConsentRecords,
  type ConsentPresentation,
} from '@/db/consent'
import { listPhotoBlobKeys, purgeUserData } from '@/db/purge-user-data'
import { deleteObjects } from '@/lib/supabase-storage'
import { getRedis } from '@/lib/redis'
import { coachChatKey } from '@/lib/coach/chat-store'
import { coachRateLimitKey } from '@/lib/coach/rate-limit'
import { deletePosthogPerson, type PosthogPersonDeletion } from '@/lib/account/posthog-person-deletion'

/**
 * The account-deletion orchestration — the app-store prerequisite and the
 * privacy policy's deletion promise, in one auditable sequence:
 *
 *  1. Evidence first: append ONE withdrawal event to the consent ledger with
 *     the processor fan-out enqueued in the same transaction
 *     (consent_downstream_actions = the MHMDA propagation evidence). The
 *     event survives deletion, pseudonymized.
 *  2. Purge Postgres (one transaction; cascades cover children).
 *  3. Remove photo objects from storage (most sensitive bytes; throws on
 *     failure so the user can retry rather than believing a false success).
 *  4. Clear per-user Redis keys (best-effort — every key is TTL-bounded, so
 *     a miss self-heals; coach drafts, rate-limit counters, import previews).
 *  5. PostHog person deletion; outcome recorded on its evidence row. A
 *     failure is recorded as 'failed' and does NOT abort — the row is the
 *     honest record of what is still owed.
 *  6. Pseudonymize the consent ledger (GUC-gated transaction), sparing this
 *     deletion's own fan-out rows via keepEventId.
 *  7. Delete the WorkOS user LAST — auth stays alive for a retry until
 *     everything else is done; after this the account is gone.
 *
 * Re-running after a mid-flight failure is safe: every step deletes toward
 * absence, and a second run just appends another (pseudonymized) withdrawal
 * event.
 */

/** Storage keys per delete request — small enough that no realistic photo
 *  count can outsize a request body. */
export const STORAGE_DELETE_BATCH_SIZE = 100

export interface AccountDeletionResult {
  pseudonym: string
  eventsPseudonymized: number
  posthog: PosthogPersonDeletion | 'failed'
}

export async function deleteAccount(
  userId: string,
  presentation: ConsentPresentation,
): Promise<AccountDeletionResult> {
  const { eventId } = await recordConsent({
    userId,
    purpose: 'health_collect',
    action: 'withdrawn',
    presentation,
    downstream: [
      { processor: 'posthog', action: 'person_delete' },
      { processor: 'workos', action: 'user_delete' },
    ],
  })

  // Storage objects go FIRST (review finding): blob keys are only knowable
  // while the rows exist — the old rows-then-storage order orphaned photos
  // forever when the bucket call failed after the purge transaction had
  // committed, because the retry re-read an empty table. Object deletion is
  // idempotent, so a failure AFTER this step retries cleanly.
  // Batched: a photo-heavy account must never build a storage request the
  // API could reject — that would strand deletion at this step on every
  // retry.
  const photoBlobKeys = await listPhotoBlobKeys(userId)
  for (let i = 0; i < photoBlobKeys.length; i += STORAGE_DELETE_BATCH_SIZE) {
    await deleteObjects(photoBlobKeys.slice(i, i + STORAGE_DELETE_BATCH_SIZE))
  }
  await purgeUserData(userId)
  await clearUserRedisKeys(userId)

  let posthog: AccountDeletionResult['posthog']
  try {
    posthog = await deletePosthogPerson(userId)
    await markDownstreamAction(eventId, 'posthog', 'completed')
  } catch (error: unknown) {
    console.error('[account-deletion] posthog person delete failed', { userId, error })
    posthog = 'failed'
    await markDownstreamAction(eventId, 'posthog', 'failed')
  }

  const { pseudonym, eventsPseudonymized } = await pseudonymizeConsentRecords(userId, {
    keepEventId: eventId,
  })

  // An auth-delete failure throws PAST the pseudonymization on purpose: the
  // account still authenticates, the user retries, and the retry's ledger pass
  // finds nothing left to pseudonymize (harmless).
  await getWorkOS().userManagement.deleteUser(userId)
  await markDownstreamAction(eventId, 'workos', 'completed')

  return { pseudonym, eventsPseudonymized, posthog }
}

/**
 * Daily cap on deletion attempts. Blast radius is already bounded (a user
 * can only delete their own account), but every attempt appends a withdrawal
 * event + fan-out rows to the consent ledger, so a hostile retry loop could
 * bloat append-only evidence tables. Same shape as the coach limiter:
 * increment-then-check, fail-open (an outage must never trap a user in the
 * app — deletion is a legal right, the cap is anti-abuse).
 */
export const ACCOUNT_DELETION_DAILY_LIMIT = 5

const RATE_LIMIT_KEY_TTL_SECONDS = 26 * 60 * 60

export type AccountDeletionRateLimit = { allowed: true } | { allowed: false; limit: number }

export async function checkAccountDeletionRateLimit(
  userId: string,
): Promise<AccountDeletionRateLimit> {
  const redis = getRedis()
  if (!redis) return { allowed: true }
  try {
    const day = new Date().toISOString().slice(0, 10)
    // NOTE: deliberately not swept by clearUserRedisKeys — deleting the
    // counter mid-flow would reset the cap on every attempt. TTL cleans it.
    const key = `account:delete:${userId}:${day}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, RATE_LIMIT_KEY_TTL_SECONDS)
    if (count > ACCOUNT_DELETION_DAILY_LIMIT) {
      return { allowed: false, limit: ACCOUNT_DELETION_DAILY_LIMIT }
    }
    return { allowed: true }
  } catch (error: unknown) {
    console.error('[account-deletion] rate limit check failed; allowing', { userId, error })
    return { allowed: true }
  }
}

/**
 * Deletes the per-user Redis keys. Day-scoped rate-limit counters cover
 * today + yesterday (the 26h TTL means nothing older can exist); import
 * previews are token-suffixed so they need a SCAN. Best-effort: every key
 * expires on its own (chat 30d, counters 26h, previews 15m), so a Redis
 * hiccup here must not fail the deletion.
 */
export async function clearUserRedisKeys(userId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await redis.del(
      coachChatKey(userId),
      coachRateLimitKey(userId),
      coachRateLimitKey(userId, yesterday),
    )

    const pattern = `import:preview:${userId}:*`
    let cursor = '0'
    do {
      const [next, keys] = await redis.scan(cursor, { match: pattern, count: 100 })
      if (keys.length > 0) await redis.del(...keys)
      cursor = String(next)
    } while (cursor !== '0')
  } catch (error: unknown) {
    console.error('[account-deletion] redis cleanup failed (keys are TTL-bounded)', {
      userId,
      error,
    })
  }
}
