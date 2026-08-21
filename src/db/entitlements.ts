import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from './index'
import { entitlementGrants, entitlementsCurrent } from './schema'
import {
  DEFAULT_TIER,
  tierRequiredFor,
  resolveEntitlement,
  tierHasFeature,
  type Feature,
  type GrantSource,
  type ResolvedEntitlement,
  type Tier,
} from '@/lib/entitlements/tiers'

/**
 * The entitlement store: the ledger writer, and the one read every gate uses.
 * See docs/ENTITLEMENTS.md for why this is ours rather than the processor's.
 *
 * Shape deliberately mirrors src/db/consent.ts — append-only ledger, a
 * projection rewritten in the same transaction, an advisory lock serializing
 * writers on one user. That pattern is already load-bearing for consent and
 * the failure it prevents (a ledger and a projection that disagree) is the
 * same one here, except the cost is a customer either losing what they paid
 * for or keeping what they stopped paying for.
 */

/** One row of the ledger, as the ops surface and the plan page read it. */
export interface EntitlementGrant {
  id: string
  userId: string
  tier: Tier
  source: GrantSource
  sourceRef: string | null
  status: 'active' | 'revoked'
  startsAt: Date
  endsAt: Date | null
  reason: string
  actorId: string | null
  revokedAt: Date | null
  revokedReason: string | null
  revokedByActorId: string | null
  createdAt: Date
}

export interface ApplyGrantInput {
  userId: string
  tier: Tier
  source: GrantSource
  /**
   * The external identity of the thing being granted — a Stripe subscription
   * id, an Apple originalTransactionId, a Google purchaseToken. Supplying it
   * makes the call idempotent (see below); a manual comp has none.
   */
  sourceRef?: string | null
  /** Defaults to now. Payment adapters pass the processor's own period start. */
  startsAt?: Date
  /** null = perpetual. */
  endsAt?: Date | null
  /** Required. A grant nobody can explain later is unauditable. */
  reason: string
  /** The ops user who did this; null when a payment processor did. */
  actorId?: string | null
}

export interface ApplyGrantResult {
  grantId: string
  /** The user's tier AFTER this grant — not necessarily the tier granted. */
  effective: ResolvedEntitlement
  /**
   * True when an identical live grant already existed, so no ledger row was
   * appended. Redelivered webhooks land here. The projection is still
   * rewritten — a redelivery is a free chance to heal one that drifted.
   */
  deduplicated: boolean
}

/**
 * The grantor seam: the ONLY way a tier is ever conferred. It does not know
 * what caused the grant, which is what lets a Stripe webhook, an Apple server
 * notification and an ops comp share every line of code below this point.
 *
 * Idempotency, for the payment adapters that do not control delivery: when
 * `sourceRef` is given and a live grant for the same (source, sourceRef)
 * already grants exactly this tier over exactly this window, nothing is
 * written and `deduplicated` comes back true. When it grants something
 * DIFFERENT — a plan change, a renewal that moved the end date — the old
 * grant is superseded rather than edited, so the change stays legible.
 */
export async function applyGrant(input: ApplyGrantInput): Promise<ApplyGrantResult> {
  return db.transaction(async (tx) => {
    await lockUserInTx(tx, input.userId)
    const { grantId, deduplicated } = await applyGrantInTx(tx, input)
    return { grantId, deduplicated, effective: await reprojectInTx(tx, input.userId) }
  })
}

/**
 * The transactional core of applyGrant, for callers composing several ledger
 * writes under ONE user lock and ONE projection rewrite (projectFromVendor
 * in src/db/billing.ts). The caller owns the transaction, MUST already hold
 * the user's advisory lock, and MUST reprojectInTx before committing — this
 * function only appends to the ledger.
 */
export async function applyGrantInTx(
  tx: Tx,
  input: ApplyGrantInput,
): Promise<{ grantId: string; deduplicated: boolean }> {
  if (!input.reason.trim()) throw new Error('a grant requires a reason')
  const startsAt = input.startsAt ?? new Date()
  const endsAt = input.endsAt ?? null
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new Error('a grant cannot end before it starts')
  }

  if (input.sourceRef) {
    const [existing] = await tx
      .select()
      .from(entitlementGrants)
      .where(
        and(
          // Scoped to the user we hold the lock on. Without this a
          // source_ref that resolved to a DIFFERENT local user — an account
          // re-map, a support mix-up — would be superseded here and never
          // reprojected, leaving that user's projection granting a tier
          // whose grant is dead. Scoping it means a genuine cross-user
          // collision hits the partial unique index and fails loudly
          // instead of corrupting quietly.
          eq(entitlementGrants.userId, input.userId),
          eq(entitlementGrants.source, input.source),
          eq(entitlementGrants.sourceRef, input.sourceRef),
          eq(entitlementGrants.status, 'active'),
        ),
      )
      .limit(1)

    if (existing) {
      const unchanged =
        existing.tier === input.tier &&
        existing.startsAt.getTime() === startsAt.getTime() &&
        (existing.endsAt?.getTime() ?? null) === (endsAt?.getTime() ?? null)
      if (unchanged) {
        return { grantId: existing.id, deduplicated: true }
      }
      // A genuine change to the same subscription. Supersede rather than
      // update: the previous terms stay readable in the ledger, and the
      // partial unique index on live (source, source_ref) stays satisfied.
      await tx
        .update(entitlementGrants)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          revokedReason: 'superseded by a newer grant for the same subscription',
          revokedByActorId: input.actorId ?? null,
        })
        .where(eq(entitlementGrants.id, existing.id))
    }
  }

  const [row] = await tx
    .insert(entitlementGrants)
    .values({
      userId: input.userId,
      tier: input.tier,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      status: 'active',
      startsAt,
      endsAt,
      reason: input.reason.trim(),
      actorId: input.actorId ?? null,
    })
    .returning({ id: entitlementGrants.id })

  return { grantId: row.id, deduplicated: false }
}

/**
 * Ends a grant without erasing it. The reason and the actor are required for
 * the same purpose as on the grant itself: the question asked months later is
 * always "who took this away, and why".
 *
 * Returns the tier the user is left on, which is frequently NOT free — a
 * revoked comp can uncover a paid subscription underneath it.
 */
export async function revokeGrant(input: {
  grantId: string
  reason: string
  actorId: string | null
}): Promise<{ userId: string; effective: ResolvedEntitlement } | null> {
  if (!input.reason.trim()) throw new Error('a revocation requires a reason')

  return db.transaction(async (tx) => {
    const [grant] = await tx
      .select({
        userId: entitlementGrants.userId,
        status: entitlementGrants.status,
      })
      .from(entitlementGrants)
      .where(eq(entitlementGrants.id, input.grantId))
      .limit(1)
    if (!grant) return null

    await lockUserInTx(tx, grant.userId)
    await revokeGrantInTx(tx, input)

    return {
      userId: grant.userId,
      effective: await reprojectInTx(tx, grant.userId),
    }
  })
}

/**
 * The transactional core of revokeGrant — same contract as applyGrantInTx:
 * the caller owns the transaction, already holds the user's lock, and
 * reprojects before committing.
 */
export async function revokeGrantInTx(
  tx: Tx,
  input: { grantId: string; reason: string; actorId: string | null },
): Promise<void> {
  if (!input.reason.trim()) throw new Error('a revocation requires a reason')

  // Re-read under the lock: a concurrent revoke must not double-stamp and
  // overwrite the first operator's reason.
  const [current] = await tx
    .select({ status: entitlementGrants.status })
    .from(entitlementGrants)
    .where(eq(entitlementGrants.id, input.grantId))
    .limit(1)

  if (current?.status === 'active') {
    await tx
      .update(entitlementGrants)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        revokedReason: input.reason.trim(),
        revokedByActorId: input.actorId,
      })
      .where(eq(entitlementGrants.id, input.grantId))
  }
}

/**
 * The live ledger rows for one (user, source) — the "ours" side of the
 * set-diff a vendor re-projection computes. Status-active only: whether a
 * row still GRANTS anything (endsAt vs the clock) is the reconciler's
 * question, not this query's.
 */
export async function listLiveGrantsInTx(
  tx: Tx,
  userId: string,
  source: GrantSource,
): Promise<EntitlementGrant[]> {
  return tx
    .select()
    .from(entitlementGrants)
    .where(
      and(
        eq(entitlementGrants.userId, userId),
        eq(entitlementGrants.source, source),
        eq(entitlementGrants.status, 'active'),
      ),
    )
}

/** The transaction handle the composable *InTx functions take. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Recomputes the projection from the WHOLE ledger rather than patching it
 * against the incumbent row. Costs one indexed read per write and buys
 * self-correction: a projection that ever drifted — a crashed process, a
 * hand-written row, a bug since fixed — heals on the next write instead of
 * compounding.
 *
 * Exported for the same composition seam as the other *InTx functions: run
 * once at the end of a multi-write transaction, under the user's lock.
 */
export async function reprojectInTx(tx: Tx, userId: string): Promise<ResolvedEntitlement> {
  const grants = await tx
    .select({
      tier: entitlementGrants.tier,
      source: entitlementGrants.source,
      status: entitlementGrants.status,
      startsAt: entitlementGrants.startsAt,
      endsAt: entitlementGrants.endsAt,
      id: entitlementGrants.id,
    })
    .from(entitlementGrants)
    .where(eq(entitlementGrants.userId, userId))

  const now = new Date()
  const effective = resolveEntitlement(grants, now)
  // Identify the winning row so ops can link the tier back to its cause.
  const winner = grants.find(
    (g) =>
      g.status === 'active' &&
      g.tier === effective.tier &&
      g.source === effective.source &&
      (g.endsAt?.getTime() ?? null) === (effective.expiresAt?.getTime() ?? null) &&
      g.startsAt.getTime() <= now.getTime(),
  )

  await tx
    .insert(entitlementsCurrent)
    .values({
      userId,
      tier: effective.tier,
      source: effective.source,
      expiresAt: effective.expiresAt,
      grantId: winner?.id ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: entitlementsCurrent.userId,
      set: {
        tier: effective.tier,
        source: effective.source,
        expiresAt: effective.expiresAt,
        grantId: winner?.id ?? null,
        updatedAt: now,
      },
    })

  return effective
}

/** Transaction-scoped, released on commit or rollback. Exported for
 *  projectFromVendor, which takes the lock BEFORE fetching vendor truth so
 *  every projection derives from a fetch made after the previous writer
 *  committed. */
export async function lockUserInTx(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'entitlement:' + userId}))`)
}

/** The default every read falls back to. Free is usable, so this is safe. */
const FREE: ResolvedEntitlement = {
  tier: DEFAULT_TIER,
  source: null,
  expiresAt: null,
}

/**
 * The hot path: one primary-key lookup, and the expiry compared against the
 * clock here rather than trusted from the row. A lapsed grant therefore stops
 * granting with nobody having sent an event to say so.
 *
 * Fails to FREE, never throws and never fails open. A database blip must not
 * hand out the AI coach, and it must not lock a paying user out of logging
 * their workout either — degrading to the free tier does neither.
 */
export async function getEntitlement(userId: string): Promise<ResolvedEntitlement> {
  try {
    const [row] = await db
      .select()
      .from(entitlementsCurrent)
      .where(eq(entitlementsCurrent.userId, userId))
      .limit(1)
    if (!row) return FREE
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return FREE
    return { tier: row.tier, source: row.source, expiresAt: row.expiresAt }
  } catch (error) {
    // Degrading to Free is the policy; doing it SILENTLY is not. A paying
    // member dropped to Free by a transient fault is the single failure here
    // most worth knowing about, and without this line it leaves no trace.
    console.error('[entitlements] read failed, degrading to free', error)
    return FREE
  }
}

/** What every gate calls. Features, never tiers — see tiers.ts. */
export async function hasFeature(userId: string, feature: Feature): Promise<boolean> {
  const { tier } = await getEntitlement(userId)
  return tierHasFeature(tier, feature)
}

/** The full ledger for one user, newest first — the ops surface's spine. */
export async function listGrants(userId: string): Promise<EntitlementGrant[]> {
  return db
    .select()
    .from(entitlementGrants)
    .where(eq(entitlementGrants.userId, userId))
    .orderBy(desc(entitlementGrants.createdAt))
}

/**
 * Every user currently on a paid tier, newest first. The ops board's "who is
 * actually paying" answer, and small enough to be a plain scan for a long
 * time yet.
 *
 * Lapsed rows are excluded in SQL rather than filtered afterwards: the
 * projection is only rewritten when something happens to a grant, so a
 * subscription that simply ran out still has tier 'max' sitting in the table
 * until then.
 */
export async function listPaidUsers(limit = 100): Promise<
  Array<{
    userId: string
    tier: Tier
    source: GrantSource | null
    expiresAt: Date | null
    updatedAt: Date
  }>
> {
  return db
    .select({
      userId: entitlementsCurrent.userId,
      tier: entitlementsCurrent.tier,
      source: entitlementsCurrent.source,
      expiresAt: entitlementsCurrent.expiresAt,
      updatedAt: entitlementsCurrent.updatedAt,
    })
    .from(entitlementsCurrent)
    .where(
      and(
        isNotNull(entitlementsCurrent.grantId),
        sql`${entitlementsCurrent.tier} <> 'free'`,
        // The same clock check getEntitlement does. Without it the roster
        // lists anyone whose projection has not been rewritten since their
        // grant lapsed — an ops board that quietly overstates who is paying.
        sql`(${entitlementsCurrent.expiresAt} is null or ${entitlementsCurrent.expiresAt} > now())`,
      ),
    )
    .orderBy(desc(entitlementsCurrent.updatedAt))
    .limit(limit)
}

// ---------------------------------------------------------------------------
// Gates — the server-side boundary. See docs/ENTITLEMENTS.md.
// ---------------------------------------------------------------------------

/**
 * Thrown when a caller asks for something their tier does not include.
 *
 * Carries the feature and the tier that WOULD grant it, because the useful
 * response is never "no" on its own — the surface that catches this has to
 * name the plan that says yes.
 */
export class FeatureRequiredError extends Error {
  constructor(
    readonly feature: Feature,
    readonly requiredTier: Tier,
  ) {
    super(`feature "${feature}" requires the ${requiredTier} plan`)
    this.name = 'FeatureRequiredError'
  }
}

/**
 * The enforcement boundary. Every server action and route handler that touches
 * a paid capability calls this; the UI's disabled buttons and upgrade prompts
 * are sales copy, not security, and a request that skips them still lands here.
 */
export async function requireFeature(userId: string, feature: Feature): Promise<void> {
  if (await hasFeature(userId, feature)) return
  throw new FeatureRequiredError(feature, tierRequiredFor(feature))
}

