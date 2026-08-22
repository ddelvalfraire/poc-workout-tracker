'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { projectFromVendor } from '@/db/billing'
import { fetchCustomerSnapshot } from '@/lib/billing/revenuecat/client'
import type { Tier } from '@/lib/entitlements/tiers'

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
