import { describe, it, expect } from 'vitest'
import { reconcileSnapshot, type EntitlementSnapshot } from './snapshot'
import type { EntitlementGrant } from '@/db/entitlements'

const NOW = new Date('2026-08-21T12:00:00Z')
const PAST = new Date('2026-08-01T12:00:00Z')
const FUTURE = new Date('2026-09-21T12:00:00Z')

function liveGrant(over: Partial<EntitlementGrant>): EntitlementGrant {
  return {
    id: 'grant-1',
    userId: 'user_01SYNTHETIC',
    tier: 'max',
    source: 'revenuecat',
    sourceRef: 'user_01SYNTHETIC:max',
    status: 'active',
    startsAt: PAST,
    endsAt: FUTURE,
    reason: 'revenuecat re-project: entitlement=max',
    actorId: null,
    revokedAt: null,
    revokedReason: null,
    revokedByActorId: null,
    createdAt: PAST,
    ...over,
  }
}

function snapshot(
  entitlements: EntitlementSnapshot['entitlements'],
): EntitlementSnapshot {
  return { userId: 'user_01SYNTHETIC', source: 'revenuecat', entitlements }
}

const MAX_ENT = {
  tier: 'max' as const,
  sourceRef: 'user_01SYNTHETIC:max',
  endsAt: FUTURE,
  detail: 'entitlement=max',
}

describe('reconcileSnapshot', () => {
  it('grants a first-sight entitlement with startsAt=now', () => {
    const plan = reconcileSnapshot([], snapshot([MAX_ENT]), NOW)
    expect(plan.toRevoke).toEqual([])
    expect(plan.toGrant).toHaveLength(1)
    expect(plan.toGrant[0]).toMatchObject({
      userId: 'user_01SYNTHETIC',
      tier: 'max',
      source: 'revenuecat',
      sourceRef: 'user_01SYNTHETIC:max',
      startsAt: NOW,
      endsAt: FUTURE,
      actorId: null,
    })
    expect(plan.toGrant[0].reason).toContain('entitlement=max')
  })

  it('keeps the incumbent startsAt for a known sourceRef, so unchanged terms dedupe downstream', () => {
    const plan = reconcileSnapshot([liveGrant({})], snapshot([MAX_ENT]), NOW)
    expect(plan.toGrant[0].startsAt).toEqual(PAST)
    expect(plan.toRevoke).toEqual([])
  })

  it('REFUND: a still-granting row absent from the snapshot is revoked', () => {
    const plan = reconcileSnapshot([liveGrant({})], snapshot([]), NOW)
    expect(plan.toGrant).toEqual([])
    expect(plan.toRevoke).toEqual([
      { grantId: 'grant-1', reason: 'absent from revenuecat on re-project' },
    ])
  })

  it('NATURAL LAPSE: an already-expired row absent from the snapshot is left alone', () => {
    const lapsed = liveGrant({ endsAt: new Date(NOW.getTime() - 1000) })
    const plan = reconcileSnapshot([lapsed], snapshot([]), NOW)
    expect(plan.toRevoke).toEqual([])
  })

  it('a LIFETIME row absent from the snapshot IS revoked — it would grant forever', () => {
    const lifetime = liveGrant({ endsAt: null })
    const plan = reconcileSnapshot([lifetime], snapshot([]), NOW)
    expect(plan.toRevoke).toHaveLength(1)
  })

  it('a lifetime snapshot entitlement grants with endsAt null', () => {
    const plan = reconcileSnapshot([], snapshot([{ ...MAX_ENT, endsAt: null }]), NOW)
    expect(plan.toGrant[0].endsAt).toBeNull()
  })

  it('an attested entitlement that already expired counts as NOT attested (clock-skew guard)', () => {
    const expired = { ...MAX_ENT, endsAt: new Date(NOW.getTime() - 1000) }
    const plan = reconcileSnapshot([liveGrant({})], snapshot([expired]), NOW)
    // Not granted (would trip ends-after-starts on first sight)…
    expect(plan.toGrant).toEqual([])
    // …and the still-granting incumbent is revoked, matching RC's claim.
    expect(plan.toRevoke).toHaveLength(1)
  })

  it('a hand-written row without a sourceRef is never revoked by the diff', () => {
    const anomaly = liveGrant({ id: 'grant-odd', sourceRef: null })
    const plan = reconcileSnapshot([anomaly], snapshot([]), NOW)
    expect(plan.toRevoke).toEqual([])
  })

  it('handles mixed states in one pass: keep pro, revoke max, grant new lifetime', () => {
    const pro = liveGrant({ id: 'g-pro', tier: 'pro', sourceRef: 'user_01SYNTHETIC:pro' })
    const max = liveGrant({ id: 'g-max' })
    const plan = reconcileSnapshot(
      [pro, max],
      snapshot([
        { tier: 'pro', sourceRef: 'user_01SYNTHETIC:pro', endsAt: FUTURE, detail: 'entitlement=pro' },
        { tier: 'max', sourceRef: 'user_01SYNTHETIC:vip', endsAt: null, detail: 'entitlement=vip' },
      ]),
      NOW,
    )
    expect(plan.toGrant.map((g) => g.sourceRef)).toEqual([
      'user_01SYNTHETIC:pro',
      'user_01SYNTHETIC:vip',
    ])
    expect(plan.toRevoke).toEqual([
      { grantId: 'g-max', reason: 'absent from revenuecat on re-project' },
    ])
  })
})
