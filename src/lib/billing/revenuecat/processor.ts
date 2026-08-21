import { projectFromVendor } from '@/db/billing'
import { fetchCustomerSnapshot, RetryableBillingError } from './client'
import { affectedUserIds, classifyEvent } from './map'
import type { RcEvent } from './types'

/**
 * Per-event orchestration: classify → resolve users → re-project each from
 * fetched truth. The payload only ever selects WHO; projectFromVendor +
 * fetchCustomerSnapshot decide WHAT they hold — including for TRANSFER,
 * which is just "re-project both sides", so no event can revoke on payload
 * say-so. See docs/SPIKE-REVENUECAT.md (edge cases).
 */

export type ProcessOutcome =
  | { kind: 'processed' }
  | { kind: 'ignored' }
  | { kind: 'orphaned'; note: string }
  | { kind: 'retryable'; error: string }

export async function processRcEvent(event: RcEvent): Promise<ProcessOutcome> {
  if (classifyEvent(event.type) === 'log-only') return { kind: 'ignored' }

  const resolved = affectedUserIds(event)
  if (resolved.kind === 'orphaned') return { kind: 'orphaned', note: resolved.note }

  try {
    for (const userId of resolved.userIds) {
      await projectFromVendor(userId, 'revenuecat', () => fetchCustomerSnapshot(userId))
    }
  } catch (error: unknown) {
    // Everything reachable here is transient (RC API weather, a DB blip) or
    // wants the same treatment as transient: fail the event, let RC's
    // redelivery schedule drive the retry, and surface it in the dead-letter
    // view if it never succeeds. Permanent states (unknown user, irrelevant
    // type) were already returned above.
    const message = error instanceof RetryableBillingError ? error.message : String(error)
    return { kind: 'retryable', error: message }
  }
  return { kind: 'processed' }
}
