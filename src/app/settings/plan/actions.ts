'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth/auth'
import { projectFromVendor } from '@/db/billing'
import { getEntitlement } from '@/db/entitlements'
import { fetchCustomerSnapshot } from '@/lib/billing/revenuecat/client'
import { getRedis } from '@/lib/redis'
import type { Tier } from '@/lib/entitlements/tiers'

/** One RC re-projection per user per cooldown window. The action exists to
 *  close a seconds-wide gap after checkout; anything faster is either a
 *  double-click or a script, and RC's customer-read budget (480/min, shared
 *  with webhook processing) must not be burnable from a browser console. */
const SYNC_COOLDOWN_SECONDS = 30

export type PlanSyncResult = { status: 'synced'; tier: Tier } | { status: 'unavailable' }

/**
 * Self-serve re-projection from RevenueCat, called by the plan page right
 * after a checkout completes. The webhook is the durable path (it arrives in
 * 5–60s and the nightly reconcile backstops it); this call just closes the
 * gap so the member sees their tier the moment they paid instead of after a
 * refresh. Idempotent with the webhook by construction — both run the same
 * fetch-inside-lock projection.
 *
 * Deliberately NOT ops-gated: it can only act on the session's own user, and
 * it can only converge the ledger on what RevenueCat actually attests — a
 * caller cannot grant themselves anything RC does not say they bought.
 */
export async function syncMyRcEntitlementsAction(): Promise<PlanSyncResult> {
  const userId = await requireUserId()

  if (!process.env.RC_API_V2_KEY || !process.env.RC_PROJECT_ID) {
    return { status: 'unavailable' }
  }

  // Cooldown BEFORE the RC call. Inside the window the action answers from
  // our own store — which the webhook keeps converging anyway — so a repeat
  // click still gets a truthful tier without spending RC budget. No Redis →
  // no limiter; the action stays usable (review finding, pr-295-review.md
  // MEDIUM-2 — the budget matters more than the edge case of Redis being
  // down during a purchase).
  const redis = getRedis()
  if (redis) {
    const claimed = await redis.set(`rcsync:${userId}`, '1', {
      nx: true,
      ex: SYNC_COOLDOWN_SECONDS,
    })
    if (claimed === null) {
      const effective = await getEntitlement(userId)
      return { status: 'synced', tier: effective.tier }
    }
  }

  try {
    const effective = await projectFromVendor(userId, 'revenuecat', () =>
      fetchCustomerSnapshot(userId),
    )
    revalidatePath('/settings/plan')
    return { status: 'synced', tier: effective.tier }
  } catch (error: unknown) {
    // The purchase is safe either way — the webhook and the nightly
    // reconcile both deliver it; this fast path just could not.
    console.error(`[plan] revenuecat self-sync failed for ${userId}`, error)
    return { status: 'unavailable' }
  }
}
