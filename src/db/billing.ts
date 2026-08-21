import { db } from './index'
import {
  applyGrantInTx,
  listLiveGrantsInTx,
  lockUserInTx,
  reprojectInTx,
  revokeGrantInTx,
} from './entitlements'
import { reconcileSnapshot, type EntitlementSnapshot } from '@/lib/billing/snapshot'
import type { GrantSource, ResolvedEntitlement } from '@/lib/entitlements/tiers'

/**
 * Re-project one user's grants for one vendor from that vendor's CURRENT
 * truth. The single write path for every vendor-sourced grant — webhook
 * processor, reconciliation cron, ops re-sync — so the ordering guarantee
 * lives in exactly one place.
 *
 * The vendor fetch happens INSIDE the per-user advisory-lock critical
 * section, deliberately: two concurrent events for the same user would
 * otherwise race their fetches, and the staler snapshot could win the lock
 * second and overwrite the fresher one (the vendor APIs offer no version to
 * fence with). Fetch-inside-lock makes every projection derive from a fetch
 * made after the previous writer committed — monotonic by construction. The
 * cost is one HTTP call of lock hold time; the fetcher must carry its own
 * timeout so a hung call cannot pin the connection (client.ts does).
 *
 * A fetcher throw rolls the transaction back untouched — the caller decides
 * whether that is retryable. See docs/SPIKE-REVENUECAT.md.
 */
export async function projectFromVendor(
  userId: string,
  source: GrantSource,
  fetchSnapshot: () => Promise<EntitlementSnapshot>,
): Promise<ResolvedEntitlement> {
  return db.transaction(async (tx) => {
    await lockUserInTx(tx, userId)

    const snapshot = await fetchSnapshot()
    if (snapshot.userId !== userId || snapshot.source !== source) {
      // A mis-wired fetcher must fail loudly, not project user A's truth
      // onto user B's ledger.
      throw new Error(
        `snapshot identity mismatch: expected (${userId}, ${source}), got (${snapshot.userId}, ${snapshot.source})`,
      )
    }

    const live = await listLiveGrantsInTx(tx, userId, source)
    const plan = reconcileSnapshot(live, snapshot, new Date())

    for (const grant of plan.toGrant) {
      await applyGrantInTx(tx, grant)
    }
    for (const revoke of plan.toRevoke) {
      await revokeGrantInTx(tx, { ...revoke, actorId: null })
    }

    return reprojectInTx(tx, userId)
  })
}
