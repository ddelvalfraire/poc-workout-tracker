import { listVendorGrantUserIds, projectFromVendor } from '@/db/billing'
import {
  countDeadLetters,
  listReprocessable,
  markFailed,
  markIgnored,
  markOrphaned,
  markProcessed,
  trimPayloads,
} from '@/db/rc-webhook-events'
import { fetchCustomerSnapshot } from './client'
import { processRcEvent } from './processor'
import { rcWebhookBodySchema } from './types'

/**
 * The daily backstop that makes every "return 200 and move on" decision in
 * the webhook safe: re-project every user we believe holds something, and
 * reprocess inbox rows the webhook path could not finish. Catches events
 * lost beyond RC's 5-retry horizon, refunds whose EXPIRATION never arrived,
 * and store-side changes that produced no event at all. Rides the existing
 * daily cron. See docs/SPIKE-REVENUECAT.md.
 */

/** received-rows younger than this may still be in-flight on a live request;
 *  older ones are a function that died mid-processing. RC's whole retry
 *  window is ~2.6h, so 3h is safely past anyone still trying. */
const STALE_RECEIVED_MS = 3 * 60 * 60 * 1000

/** Payloads have no replay value once RC's retries and our sweep are long
 *  past; they can carry subscriber-attribute PII, so they age out. */
const PAYLOAD_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export interface ReconcileReport {
  /** Users with live RC grants that were re-projected. */
  swept: number
  /** Sweep re-projections that failed (RC weather) — retried tomorrow. */
  sweepFailures: number
  /** Inbox rows reprocessed to a terminal state. */
  reprocessed: number
  /** Inbox rows that failed again and stay in the dead-letter view. */
  reprocessFailures: number
  trimmedPayloads: number
  deadLetters: { failed: number; orphaned: number }
}

/** Null = the RC adapter is not configured in this environment; nothing to do. */
export async function reconcileRevenueCat(now = new Date()): Promise<ReconcileReport | null> {
  if (!process.env.RC_API_V2_KEY || !process.env.RC_PROJECT_ID) return null

  // Sweep 1: everyone we believe holds something, re-projected from truth.
  // Per-user failures never abort the sweep — one flaky fetch must not hide
  // every other user behind it.
  let swept = 0
  let sweepFailures = 0
  for (const userId of await listVendorGrantUserIds('revenuecat')) {
    try {
      await projectFromVendor(userId, 'revenuecat', () => fetchCustomerSnapshot(userId))
      swept += 1
    } catch (error: unknown) {
      sweepFailures += 1
      console.error(`[revenuecat] reconcile sweep failed for ${userId}`, error)
    }
  }

  // Sweep 2: inbox rows the webhook path never finished — including a lost
  // INITIAL_PURCHASE, whose user has no grant row for sweep 1 to find.
  let reprocessed = 0
  let reprocessFailures = 0
  const rows = await listReprocessable({
    staleReceivedBefore: new Date(now.getTime() - STALE_RECEIVED_MS),
  })
  for (const row of rows) {
    const parsed = rcWebhookBodySchema.safeParse(row.payload)
    if (!parsed.success) {
      // Trimmed or malformed payload: nothing left to reprocess from. The
      // grant-sweep above is the remaining safety net for its user.
      await markOrphaned(row.id, 'payload unavailable for reprocessing')
      reprocessed += 1
      continue
    }
    try {
      const outcome = await processRcEvent(parsed.data.event)
      if (outcome.kind === 'retryable') {
        await markFailed(row.id, outcome.error)
        reprocessFailures += 1
      } else {
        if (outcome.kind === 'orphaned') await markOrphaned(row.id, outcome.note)
        else if (outcome.kind === 'ignored') await markIgnored(row.id)
        else await markProcessed(row.id)
        reprocessed += 1
      }
    } catch (error: unknown) {
      await markFailed(row.id, String(error))
      reprocessFailures += 1
    }
  }

  const trimmedPayloads = await trimPayloads(new Date(now.getTime() - PAYLOAD_RETENTION_MS))

  const deadLetters = await countDeadLetters()
  if (deadLetters.failed > 0 || deadLetters.orphaned > 0) {
    // The alerting seam: Vercel log-based alerts key on this line. Lifetime
    // tallies, deliberately — an orphan stays worth a human's eyes until an
    // ops action resolves it (follow-up PR adds that surface).
    console.error(
      `[revenuecat] dead letters: ${deadLetters.failed} failed, ${deadLetters.orphaned} orphaned`,
    )
  }

  return { swept, sweepFailures, reprocessed, reprocessFailures, trimmedPayloads, deadLetters }
}
