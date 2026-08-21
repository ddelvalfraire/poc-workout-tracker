import type { ApplyGrantInput, EntitlementGrant } from '@/db/entitlements'
import type { GrantSource, Tier } from '@/lib/entitlements/tiers'

/**
 * The vendor-neutral contract every billing adapter produces: a SNAPSHOT of
 * what the vendor says one user currently holds, and the pure set-diff that
 * turns it into ledger operations. This is the whole adapter "interface" —
 * a data shape plus one function; see docs/SPIKE-REVENUECAT.md (blueprint).
 */

/** One entitlement the vendor currently attests. No start date: vendors
 *  attest CURRENT access, not history — the reconciler derives startsAt from
 *  the incumbent row (or now, on first sight) so re-projection stays
 *  idempotent instead of superseding on every event. */
export interface SnapshotEntitlement {
  tier: Tier
  /** The vendor-stable identity of this access — for RevenueCat,
   *  `${appUserId}:${entitlementLookupKey}`. The applyGrant idempotency key. */
  sourceRef: string
  /** null = lifetime. */
  endsAt: Date | null
  /** Human context for the grant reason, e.g. 'entitlement=max'. */
  detail: string
}

/** What a vendor says one user currently holds. The unit of truth-transfer. */
export interface EntitlementSnapshot {
  userId: string
  source: GrantSource
  entitlements: SnapshotEntitlement[]
}

export interface ReconcilePlan {
  /** Everything the snapshot attests. applyGrantInTx dedupes rows that are
   *  already live with identical terms and supersedes changed ones, so this
   *  side deliberately does NOT pre-diff — that logic exists once, tested,
   *  in the grantor. */
  toGrant: ApplyGrantInput[]
  /** Live rows the vendor no longer attests AND that still grant something.
   *  This is where a refund actually takes effect: RC pulls the entitlement
   *  immediately, the row's endsAt is still in the future, and only this
   *  diff closes it. */
  toRevoke: Array<{ grantId: string; reason: string }>
}

/**
 * The set diff at the heart of vendor re-projection. Pure — the clock is an
 * argument — so the refund/lapse/lifetime matrix is cheap to pin in tests.
 *
 * `live` must be the ledger rows for exactly (snapshot.userId,
 * snapshot.source), status-active — listLiveGrantsInTx's contract.
 */
export function reconcileSnapshot(
  live: readonly EntitlementGrant[],
  snapshot: EntitlementSnapshot,
  now: Date,
): ReconcilePlan {
  // An entitlement the vendor reports as active but already expired (clock
  // skew at the boundary) grants nothing and would trip applyGrant's
  // ends-after-starts check on first sight; treating it as not attested lets
  // the revoke side close any still-granting incumbent, which matches what
  // the vendor is actually saying.
  const current = snapshot.entitlements.filter(
    (e) => e.endsAt === null || e.endsAt.getTime() > now.getTime(),
  )
  const attested = new Set(current.map((e) => e.sourceRef))
  const incumbentStart = new Map(
    live.filter((g) => g.sourceRef).map((g) => [g.sourceRef as string, g.startsAt]),
  )

  const toGrant: ApplyGrantInput[] = current.map((e) => ({
    userId: snapshot.userId,
    tier: e.tier,
    source: snapshot.source,
    sourceRef: e.sourceRef,
    // Keep the incumbent's start so an unchanged entitlement dedupes instead
    // of superseding on every event; a renewal then supersedes on endsAt
    // alone, which reads correctly in the ledger ("same subscription, new
    // window end").
    startsAt: incumbentStart.get(e.sourceRef) ?? now,
    endsAt: e.endsAt,
    reason: `${snapshot.source} re-project: ${e.detail}`,
    actorId: null,
  }))

  const toRevoke = live
    .filter((g) => {
      // A row without a sourceRef under a vendor source is a hand-written
      // anomaly this diff cannot match; leave it for a human, never revoke
      // on its behalf.
      if (!g.sourceRef) return false
      if (attested.has(g.sourceRef)) return false
      // A naturally lapsed row grants nothing (expiry is enforced at read
      // time) — closing it would only add ledger noise. Revoke only rows
      // that still grant now or in the future.
      return g.endsAt === null || g.endsAt.getTime() > now.getTime()
    })
    .map((g) => ({
      grantId: g.id,
      reason: `absent from ${snapshot.source} on re-project`,
    }))

  return { toGrant, toRevoke }
}
