import { describe, expect, test } from 'vitest'
import {
  DEFAULT_TIER,
  TIERS,
  activeProgramLimitFor,
  compareTiers,
  featuresFor,
  isGrantSource,
  isTier,
  resolveEntitlement,
  tierHasFeature,
  type Feature,
  type ResolvableGrant,
  type Tier,
} from './tiers'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000)

function grant(over: Partial<ResolvableGrant> = {}): ResolvableGrant {
  return {
    tier: 'pro',
    source: 'stripe',
    status: 'active',
    startsAt: hours(-24),
    endsAt: hours(24),
    ...over,
  }
}

describe('tier vocabulary', () => {
  test('ranks the tiers in the order they are sold', () => {
    expect(compareTiers('free', 'pro')).toBeLessThan(0)
    expect(compareTiers('max', 'pro')).toBeGreaterThan(0)
    expect(compareTiers('max', 'max')).toBe(0)
  })

  test('rejects a string that is not a tier', () => {
    expect(isTier('max')).toBe(true)
    expect(isTier('enterprise')).toBe(false)
  })

  test('rejects a string that is not a grant source', () => {
    expect(isGrantSource('stripe')).toBe(true)
    expect(isGrantSource('paypal')).toBe(false)
  })

  // The mapping is the product. These assertions are the spec of what each
  // tier buys, and changing one is meant to require changing a test.
  test('free buys none of the paid features', () => {
    expect(featuresFor('free')).toEqual([])
    expect(tierHasFeature('free', 'coach')).toBe(false)
    expect(tierHasFeature('free', 'unlimited_programs')).toBe(false)
  })

  test('pro lifts the program cap but not the AI features', () => {
    expect(tierHasFeature('pro', 'unlimited_programs')).toBe(true)
    expect(tierHasFeature('pro', 'coach')).toBe(false)
    expect(tierHasFeature('pro', 'autoreg')).toBe(false)
  })

  test('max buys everything pro buys, plus coach and autoreg', () => {
    for (const feature of featuresFor('pro')) {
      expect(tierHasFeature('max', feature)).toBe(true)
    }
    expect(tierHasFeature('max', 'coach')).toBe(true)
    expect(tierHasFeature('max', 'autoreg')).toBe(true)
  })

  // Guards the invariant rather than the current contents: a higher tier
  // must never lose a feature a lower one has, or an upgrade would take
  // something away.
  test('every tier is a superset of the one below it', () => {
    for (let i = 1; i < TIERS.length; i += 1) {
      const lower = featuresFor(TIERS[i - 1])
      const higher = featuresFor(TIERS[i])
      for (const feature of lower) {
        expect(higher).toContain(feature)
      }
    }
  })

  test('caps free at two active programs and lifts the cap for paid tiers', () => {
    expect(activeProgramLimitFor('free')).toBe(2)
    expect(activeProgramLimitFor('pro')).toBeNull()
    expect(activeProgramLimitFor('max')).toBeNull()
  })
})

describe('resolveEntitlement', () => {
  test('no grants at all resolves to the default tier, not to an error', () => {
    expect(resolveEntitlement([], NOW)).toEqual({
      tier: DEFAULT_TIER,
      source: null,
      expiresAt: null,
    })
  })

  test('a live grant confers its tier and reports when it runs out', () => {
    const ends = hours(48)
    expect(resolveEntitlement([grant({ tier: 'max', endsAt: ends })], NOW)).toEqual({
      tier: 'max',
      source: 'stripe',
      expiresAt: ends,
    })
  })

  test('a perpetual grant reports no expiry', () => {
    expect(resolveEntitlement([grant({ endsAt: null })], NOW).expiresAt).toBeNull()
  })

  // The whole reason the projection stores expiresAt: a lapsed grant must
  // stop granting with nobody sending an event to say so.
  test('a grant that has already ended grants nothing', () => {
    const lapsed = grant({ tier: 'max', endsAt: hours(-1) })
    expect(resolveEntitlement([lapsed], NOW).tier).toBe('free')
  })

  test('a grant that has not started yet grants nothing', () => {
    const future = grant({
      tier: 'max',
      startsAt: hours(1),
      endsAt: hours(72),
    })
    expect(resolveEntitlement([future], NOW).tier).toBe('free')
  })

  test('a revoked grant grants nothing even while its dates are live', () => {
    expect(resolveEntitlement([grant({ tier: 'max', status: 'revoked' })], NOW).tier).toBe('free')
  })

  test('expiry is exclusive at the boundary and start is inclusive', () => {
    expect(resolveEntitlement([grant({ endsAt: NOW })], NOW).tier).toBe('free')
    expect(resolveEntitlement([grant({ startsAt: NOW })], NOW).tier).toBe('pro')
  })

  test('the highest live tier wins regardless of the order it is listed', () => {
    const pro = grant({ tier: 'pro', source: 'stripe' })
    const max = grant({ tier: 'max', source: 'apple' })
    expect(resolveEntitlement([pro, max], NOW).tier).toBe('max')
    expect(resolveEntitlement([max, pro], NOW).tier).toBe('max')
  })

  test('a lapsed higher tier does not outrank a live lower one', () => {
    const deadMax = grant({ tier: 'max', endsAt: hours(-1) })
    const livePro = grant({ tier: 'pro', endsAt: hours(24) })
    expect(resolveEntitlement([deadMax, livePro], NOW).tier).toBe('pro')
  })

  // Double-subscribe across platforms: take the better of the two rather
  // than whichever webhook happened to land last.
  test('tied tiers break to the grant that protects the user longest', () => {
    const short = grant({ tier: 'max', source: 'apple', endsAt: hours(24) })
    const long = grant({ tier: 'max', source: 'stripe', endsAt: hours(240) })
    expect(resolveEntitlement([short, long], NOW).source).toBe('stripe')
    expect(resolveEntitlement([long, short], NOW).source).toBe('stripe')
  })

  test('perpetual outlasts every dated grant of the same tier', () => {
    const dated = grant({
      tier: 'max',
      source: 'stripe',
      endsAt: hours(10_000),
    })
    const forever = grant({ tier: 'max', source: 'manual', endsAt: null })
    expect(resolveEntitlement([dated, forever], NOW)).toMatchObject({
      source: 'manual',
      expiresAt: null,
    })
    expect(resolveEntitlement([forever, dated], NOW).source).toBe('manual')
  })

  test('a support comp can outrank a paid subscription', () => {
    const paid = grant({ tier: 'pro', source: 'stripe' })
    const comp = grant({ tier: 'max', source: 'manual', endsAt: null })
    expect(resolveEntitlement([paid, comp], NOW)).toMatchObject({
      tier: 'max',
      source: 'manual',
    })
  })

  test('resolution never mutates the grants it was handed', () => {
    const grants = [grant({ tier: 'max' }), grant({ tier: 'pro' })]
    const snapshot = JSON.stringify(grants)
    resolveEntitlement(grants, NOW)
    expect(JSON.stringify(grants)).toBe(snapshot)
  })
})

describe('the feature type stays honest', () => {
  // Every declared feature must be reachable from some tier: a key nobody
  // sells is a gate that can never open.
  test('every feature is granted by at least one tier', () => {
    const granted = new Set<Feature>(TIERS.flatMap((t: Tier) => [...featuresFor(t)]))
    for (const feature of ['coach', 'autoreg', 'unlimited_programs'] as const) {
      expect(granted.has(feature)).toBe(true)
    }
  })
})
