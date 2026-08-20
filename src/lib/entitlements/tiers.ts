/**
 * The tier/feature vocabulary — pure, client-safe, and the ONLY place the
 * mapping from "what we sell" to "what the code checks" lives.
 *
 * Call sites ask for a feature (`coach`), never for a tier (`max`). That
 * indirection is what makes a comp, a grandfathered price or a repackaged
 * plan a data change instead of an edit to every gate. See docs/ENTITLEMENTS.md.
 *
 * No imports from the db or the network: this module is rendered in the
 * browser by the plan surface and imported by server gates alike.
 */

export type Tier = 'free' | 'pro' | 'max'

/** Cheapest first. The display order on the plan surface, too. */
export const TIERS = ['free', 'pro', 'max'] as const

/**
 * Comparable rank. Precedence between two live grants is decided on this, so
 * it must stay a total order — a tier that is "different but not higher"
 * has no representation here, deliberately.
 */
const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, max: 2 }

/** The tier every user has without any grant at all — and the failure mode. */
export const DEFAULT_TIER: Tier = 'free'

export function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value)
}

/** Negative when `a` is worth less than `b`; 0 when equal. */
export function compareTiers(a: Tier, b: Tier): number {
  return TIER_RANK[a] - TIER_RANK[b]
}

/**
 * Monetizable capabilities. Kept deliberately small: a feature key here is a
 * promise that the gate exists, so inventing keys ahead of the gates would
 * describe a product we do not sell.
 *
 * Nothing already shipped and free is listed — retroactively paywalling an
 * existing feature is a product decision, not a consequence of building this.
 */
export type Feature = 'coach' | 'autoreg'

const TIER_FEATURES: Record<Tier, readonly Feature[]> = {
  free: [],
  // Autoreg sits in Pro, not Max, because it costs nothing per use. Reserving
  // a zero-marginal-cost feature for the top tier is artificial scarcity; the
  // paid line belongs where our costs actually are.
  pro: ['autoreg'],
  // Coach is the only thing Max adds, deliberately: it is the one feature with
  // a real per-message cost, so it is the one worth metering behind a price.
  max: ['autoreg', 'coach'],
}

export function featuresFor(tier: Tier): readonly Feature[] {
  return TIER_FEATURES[tier]
}

export function tierHasFeature(tier: Tier, feature: Feature): boolean {
  return TIER_FEATURES[tier].includes(feature)
}

/**
 * The CHEAPEST tier that includes a feature — what an upgrade prompt has to
 * name. Derived from the map rather than listed separately, so re-packaging a
 * feature cannot leave the paywall advertising the wrong plan.
 */
export function tierRequiredFor(feature: Feature): Tier {
  const tier = TIERS.find((t) => TIER_FEATURES[t].includes(feature))
  // Unreachable while every feature is sold by some tier — pinned by a test.
  if (!tier) throw new Error(`no tier grants "${feature}"`)
  return tier
}

/**
 * Where a grant came from. `manual` is a support/ops comp; `promo` is a
 * campaign code. The two payment sources that do not exist yet are named
 * anyway, because the resolution rules below have to be right about them
 * before the adapters are written, not after.
 */
export type GrantSource = 'stripe' | 'apple' | 'google' | 'manual' | 'promo'

export const GRANT_SOURCES = ['stripe', 'apple', 'google', 'manual', 'promo'] as const

export function isGrantSource(value: string): value is GrantSource {
  return (GRANT_SOURCES as readonly string[]).includes(value)
}

export type GrantStatus = 'active' | 'revoked'

/** The subset of a grant row that resolution actually reads. */
export interface ResolvableGrant {
  tier: Tier
  source: GrantSource
  status: GrantStatus
  startsAt: Date
  /** null = perpetual (a lifetime purchase, or an open-ended comp). */
  endsAt: Date | null
}

export interface ResolvedEntitlement {
  tier: Tier
  /** null when nothing is granted and the user is simply on the default. */
  source: GrantSource | null
  /** null when perpetual, or when the user is on the default tier. */
  expiresAt: Date | null
}

/**
 * The precedence rule, in one pure function so it can be tested exhaustively
 * and reused by the projection writer, the ops surface and the plan page
 * without any of them re-deriving it.
 *
 * Live means: not revoked, already started, and not yet ended. Among the
 * live grants the highest tier wins; ties go to whichever protects the user
 * longest, with perpetual beating every dated grant.
 *
 * A user who bought on web and again on iOS therefore gets the better of the
 * two rather than whichever webhook landed last. Neither purchase is
 * discarded — both stay in the ledger for a human to reconcile.
 */
export function resolveEntitlement(
  grants: readonly ResolvableGrant[],
  now: Date,
): ResolvedEntitlement {
  const live = grants.filter(
    (g) =>
      g.status === 'active' &&
      g.startsAt.getTime() <= now.getTime() &&
      (g.endsAt === null || g.endsAt.getTime() > now.getTime()),
  )
  if (live.length === 0) return { tier: DEFAULT_TIER, source: null, expiresAt: null }

  const best = live.reduce((winner, candidate) => {
    const byTier = compareTiers(candidate.tier, winner.tier)
    if (byTier !== 0) return byTier > 0 ? candidate : winner
    return outlasts(candidate, winner) ? candidate : winner
  })

  return { tier: best.tier, source: best.source, expiresAt: best.endsAt }
}

/** Perpetual outlasts everything; otherwise the later end date wins. */
function outlasts(candidate: ResolvableGrant, incumbent: ResolvableGrant): boolean {
  if (candidate.endsAt === null) return true
  if (incumbent.endsAt === null) return false
  return candidate.endsAt.getTime() > incumbent.endsAt.getTime()
}
