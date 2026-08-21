import type { Tier } from '@/lib/entitlements/tiers'
import type { RcEvent } from './types'

/**
 * Pure mapping + triage for RevenueCat events. No IO — the tables and rules
 * here are the ones the spike's event-triage section pinned down
 * (docs/SPIKE-REVENUECAT.md).
 */

/**
 * RC entitlement identifier → our tier. RC entitlements are named after the
 * TIERS we sell (configured in the RC dashboard), never after feature keys —
 * the tier→feature map stays ours in tiers.ts. An id missing here (a
 * dashboard typo, a future tier) is skipped with a warning by the caller,
 * never a throw: one bad id must not poison every event for the customer.
 */
export const RC_ENTITLEMENT_TIERS: Record<string, Tier> = {
  pro: 'pro',
  max: 'max',
}

/**
 * What an event means for entitlements. Everything relevant collapses to
 * "re-project the affected users from fetched truth"; the payload only ever
 * selects WHO. `log-only` events (and unknown future types) are recorded in
 * the inbox and ignored — deliberately including CANCELLATION (auto-renew
 * off; access runs to period end), SUBSCRIPTION_PAUSED (revocation arrives
 * later as EXPIRATION), and BILLING_ISSUE (grace period keeps access).
 */
export type EventClass = 'reproject' | 'transfer' | 'log-only'

const REPROJECT_TYPES: ReadonlySet<string> = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'REFUND_REVERSED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  // EXPIRATION is a re-project, not a no-op: a refund pulls the entitlement
  // while our row's endsAt is still in the future — only the fetch-diff
  // closes it. A natural lapse re-projects to the same answer, harmlessly.
  'EXPIRATION',
])

export function classifyEvent(type: string): EventClass {
  if (type === 'TRANSFER') return 'transfer'
  if (REPROJECT_TYPES.has(type)) return 'reproject'
  return 'log-only'
}

/** Our user ids are WorkOS ids. RC anonymous ids ($RCAnonymousID:...) and
 *  anything else RC has aliased are not resolvable on our side. */
function isOurUserId(id: string): boolean {
  return id.startsWith('user_')
}

export type ResolvedUsers =
  | { kind: 'users'; userIds: string[] }
  | { kind: 'orphaned'; note: string }

/**
 * Which of OUR users an event is about. Payload data selects who; it never
 * decides what they hold — that comes from the API fetch inside the lock.
 *
 * Resolution rule (edge-case pass): take app_user_id when it is ours;
 * otherwise accept EXACTLY one ours-shaped id from the aliases; zero or
 * several is an orphan — never guess between two of our accounts.
 *
 * TRANSFER re-projects every resolvable id on BOTH sides (the union), so a
 * forged or buggy transfer can only cause truth-fetches, never a
 * payload-driven revoke. Unresolvable ids on a transfer are dropped — the
 * losing side may legitimately be an RC-anonymous id we never knew.
 */
export function affectedUserIds(event: RcEvent): ResolvedUsers {
  if (classifyEvent(event.type) === 'transfer') {
    const ids = [...(event.transferred_from ?? []), ...(event.transferred_to ?? [])].filter(
      isOurUserId,
    )
    const unique = [...new Set(ids)]
    if (unique.length === 0) {
      return { kind: 'orphaned', note: 'transfer with no resolvable user ids' }
    }
    return { kind: 'users', userIds: unique }
  }

  if (event.app_user_id && isOurUserId(event.app_user_id)) {
    return { kind: 'users', userIds: [event.app_user_id] }
  }

  const fromAliases = [...new Set((event.aliases ?? []).filter(isOurUserId))]
  if (fromAliases.length === 1) {
    return { kind: 'users', userIds: fromAliases }
  }
  return {
    kind: 'orphaned',
    note:
      fromAliases.length === 0
        ? `no resolvable user id (app_user_id: ${event.app_user_id ?? 'none'})`
        : `ambiguous aliases resolve to ${fromAliases.length} of our users`,
  }
}
