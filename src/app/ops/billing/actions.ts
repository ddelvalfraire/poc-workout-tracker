'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { isOpsUser } from '@/lib/ops/access'
import { applyGrant, revokeGrant } from '@/db/entitlements'
import { isTier, type Tier } from '@/lib/entitlements/tiers'
import { endsAtFor, isGrantDuration } from '@/lib/entitlements/duration'

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

/** Shortest reason that can still mean something to whoever reads it later. */
const MIN_REASON_LENGTH = 3

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
  if (reason.length < MIN_REASON_LENGTH) return { status: 'invalid', field: 'reason' }

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
  if (reason.length < MIN_REASON_LENGTH) return { status: 'invalid', field: 'reason' }

  const result = await revokeGrant({ grantId: input.grantId, reason, actorId })
  if (!result) return { status: 'notFound' }

  revalidatePath('/ops/billing')
  return { status: 'revoked' }
}
