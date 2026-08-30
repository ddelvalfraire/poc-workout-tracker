'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth/auth'
import { isOpsUser } from '@/lib/ops/access'
import { applyGrant, revokeGrant } from '@/db/entitlements'
import { projectFromVendor } from '@/db/billing'
import { resolveEvent } from '@/db/rc-webhook-events'
import { fetchCustomerSnapshot } from '@/lib/billing/revenuecat/client'
import { isTier, type Tier } from '@/lib/entitlements/tiers'
import {
  endsAtFor,
  isGrantDuration,
  MAX_GRANT_REASON_LENGTH,
  MIN_GRANT_REASON_LENGTH,
} from '@/lib/entitlements/duration'

/**
 * The two write actions behind /ops/billing.
 *
 * Both re-assert `isOpsUser` themselves. A server action is a public HTTP
 * endpoint that happens to be written next to a component: gating only the
 * page that renders the form would leave the action callable by anyone who
 * knows its id. The page's gate protects the view; these protect the writes,
 * and they are not the same gate.
 *
 * Neither action takes an actor id from the caller. The operator recorded in
 * the ledger is the session's own user, so a forged request cannot attribute
 * a comp to somebody else.
 */

export type GrantActionResult =
  | { status: 'granted'; tier: Tier }
  | { status: 'revoked' }
  | { status: 'denied' }
  | { status: 'invalid'; field: 'user' | 'tier' | 'reason' | 'duration' }
  | { status: 'notFound' }

/**
 * Grants a tier by hand — a support comp, a refund make-good, or a tester
 * getting Max on staging. Always `source: 'manual'`: a hand grant must never
 * be able to impersonate a Stripe subscription, because the payment adapters
 * key their idempotency on (source, sourceRef) and a fake ref there would
 * make a real webhook silently deduplicate against it.
 */
export async function grantTierAction(input: {
  userId: string
  tier: string
  duration: string
  reason: string
}): Promise<GrantActionResult> {
  const actorId = await requireUserId()
  if (!isOpsUser(actorId)) return { status: 'denied' }

  const targetUserId = input.userId.trim()
  if (!targetUserId) return { status: 'invalid', field: 'user' }
  if (!isTier(input.tier)) return { status: 'invalid', field: 'tier' }
  if (!isGrantDuration(input.duration)) return { status: 'invalid', field: 'duration' }

  const reason = input.reason.trim()
  if (reason.length < MIN_GRANT_REASON_LENGTH || reason.length > MAX_GRANT_REASON_LENGTH) {
    return { status: 'invalid', field: 'reason' }
  }

  const startsAt = new Date()
  const result = await applyGrant({
    userId: targetUserId,
    tier: input.tier,
    source: 'manual',
    startsAt,
    endsAt: endsAtFor(input.duration, startsAt),
    reason,
    actorId,
  })

  revalidatePath('/ops/billing')
  return { status: 'granted', tier: result.effective.tier }
}

/**
 * Ends a grant. The row survives — this stamps a reason and an actor onto it
 * — so the ledger still answers "who took this away" a year from now.
 */
export async function revokeGrantAction(input: {
  grantId: string
  reason: string
}): Promise<GrantActionResult> {
  const actorId = await requireUserId()
  if (!isOpsUser(actorId)) return { status: 'denied' }

  const reason = input.reason.trim()
  if (reason.length < MIN_GRANT_REASON_LENGTH || reason.length > MAX_GRANT_REASON_LENGTH) {
    return { status: 'invalid', field: 'reason' }
  }

  const result = await revokeGrant({ grantId: input.grantId, reason, actorId })
  if (!result) return { status: 'notFound' }

  revalidatePath('/ops/billing')
  return { status: 'revoked' }
}

export type RcResyncResult =
  | { status: 'synced'; tier: Tier }
  | { status: 'denied' }
  | { status: 'unconfigured' }
  | { status: 'failed' }

/**
 * The support runbook button: re-project one member from RevenueCat's
 * current truth, through the exact same fetch-inside-lock path the webhook
 * and the nightly reconcile use. This is how a "I paid but have no access"
 * ticket resolves without a DB session — and the recovery path for the one
 * blind spot (an event never received at all, retries exhausted).
 */
export async function resyncFromRevenueCatAction(input: {
  userId: string
}): Promise<RcResyncResult> {
  const actorId = await requireUserId()
  if (!isOpsUser(actorId)) return { status: 'denied' }

  if (!process.env.RC_API_V2_KEY || !process.env.RC_PROJECT_ID) {
    return { status: 'unconfigured' }
  }

  const targetUserId = input.userId.trim()
  // Shape-check before projecting: a mistyped id that happens to be another
  // valid user's would otherwise run a real re-projection against the wrong
  // account. WorkOS user ids are `user_`-prefixed. (Adversarial finding L4.)
  if (!targetUserId.startsWith('user_')) return { status: 'failed' }

  try {
    const effective = await projectFromVendor(targetUserId, 'revenuecat', () =>
      fetchCustomerSnapshot(targetUserId),
    )
    revalidatePath('/ops/billing')
    return { status: 'synced', tier: effective.tier }
  } catch (error: unknown) {
    console.error(`[ops] revenuecat re-sync failed for ${targetUserId}`, error)
    return { status: 'failed' }
  }
}

export type RcResolveResult =
  | { status: 'resolved' }
  | { status: 'denied' }
  | { status: 'invalid' }
  | { status: 'notFound' }

/**
 * Closes a dead-letter webhook row once a human has dealt with it (or
 * decided it needs no dealing). Reason required and the actor is stamped
 * into the note — the inbox has no actor column, so the note IS the
 * attribution, same discipline as the grant ledger.
 */
export async function resolveRcEventAction(input: {
  eventId: string
  reason: string
}): Promise<RcResolveResult> {
  const actorId = await requireUserId()
  if (!isOpsUser(actorId)) return { status: 'denied' }

  const reason = input.reason.trim()
  if (reason.length < MIN_GRANT_REASON_LENGTH || reason.length > MAX_GRANT_REASON_LENGTH) {
    return { status: 'invalid' }
  }

  const resolved = await resolveEvent(input.eventId, `resolved by ${actorId}: ${reason}`)
  if (!resolved) return { status: 'notFound' }

  revalidatePath('/ops/billing')
  return { status: 'resolved' }
}
