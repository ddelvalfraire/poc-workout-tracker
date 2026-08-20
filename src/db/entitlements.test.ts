import { describe, it, test, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs for the Drizzle builders, mirroring consent.test.ts:
 * selects resolve to `selectQueue` entries (shifted per call, so the
 * multi-select flows inside one transaction can be scripted), inserts record
 * their values, `.onConflictDoUpdate` records the projection upsert.
 */
let selectQueue: Record<string, unknown>[][] = []
const inserts: { values: Record<string, unknown> }[] = []
const upserts: { values: Record<string, unknown>; conflict: unknown }[] = []
const updates: { set: Record<string, unknown> }[] = []
const ops: string[] = []
const executed: unknown[] = []
let selectThrows = false

function nextSelectRows() {
  if (selectThrows) return Promise.reject(new Error('database is down'))
  return Promise.resolve(selectQueue.length > 0 ? selectQueue.shift()! : [])
}

function makeDb() {
  const selectBuilder = () => {
    const b: Record<string, unknown> = {}
    b.from = () => b
    b.where = () => b
    b.orderBy = () => b
    b.limit = () => nextSelectRows()
    // reproject/listGrants await after .where()/.orderBy() with no .limit().
    b.then = (resolve: (rows: unknown[]) => void, reject: (e: unknown) => void) =>
      nextSelectRows().then(resolve, reject)
    return b
  }
  const database = {
    execute: (statement: unknown) => {
      ops.push('execute')
      executed.push(statement)
      return Promise.resolve()
    },
    select: () => selectBuilder(),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: () => {
          ops.push('update')
          updates.push({ set: s })
          return Promise.resolve()
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        ops.push('insert')
        inserts.push({ values: v })
        return {
          returning: () => Promise.resolve([{ id: 'grant-1' }]),
          onConflictDoUpdate: (c: unknown) => {
            // An upsert is not a ledger append: take it back out of `inserts`
            // so that array stays a clean record of granted rows.
            inserts.pop()
            ops[ops.lastIndexOf('insert')] = 'upsert'
            upserts.push({ values: v, conflict: c })
            return Promise.resolve()
          },
        }
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(database),
  }
  return database
}

vi.mock('./index', () => ({ db: makeDb() }))

import {
  FeatureRequiredError,
  applyGrant,
  revokeGrant,
  getEntitlement,
  hasFeature,
  listGrants,
  requireFeature,
} from './entitlements'

const HOUR = 3_600_000
const future = () => new Date(Date.now() + 24 * HOUR)
const past = () => new Date(Date.now() - HOUR)

function liveGrant(over: Record<string, unknown> = {}) {
  return {
    id: 'grant-existing',
    tier: 'pro',
    source: 'stripe',
    status: 'active',
    startsAt: new Date(Date.now() - HOUR),
    endsAt: future(),
    ...over,
  }
}

beforeEach(() => {
  selectQueue = []
  inserts.length = 0
  upserts.length = 0
  updates.length = 0
  ops.length = 0
  executed.length = 0
  selectThrows = false
})

describe('applyGrant', () => {
  it('refuses a grant with no stated reason', async () => {
    await expect(
      applyGrant({
        userId: 'u1',
        tier: 'max',
        source: 'manual',
        reason: '   ',
      }),
    ).rejects.toThrow(/reason/)
    expect(inserts).toHaveLength(0)
  })

  it('refuses a window that ends before it starts', async () => {
    await expect(
      applyGrant({
        userId: 'u1',
        tier: 'max',
        source: 'manual',
        reason: 'comp',
        startsAt: future(),
        endsAt: past(),
      }),
    ).rejects.toThrow(/end before it starts/)
  })

  // The lock is what keeps the ledger and the projection from disagreeing
  // under concurrent writers, so its presence is part of the contract.
  it('takes the per-user advisory lock before writing anything', async () => {
    selectQueue = [[]]
    await applyGrant({
      userId: 'u1',
      tier: 'max',
      source: 'manual',
      reason: 'comp',
    })
    expect(ops[0]).toBe('execute')
    expect(ops.indexOf('execute')).toBeLessThan(ops.indexOf('insert'))
  })

  it('writes the ledger row and the projection in the same transaction', async () => {
    const ends = future()
    selectQueue = [
      [
        {
          ...liveGrant({
            id: 'grant-1',
            tier: 'max',
            source: 'manual',
            endsAt: ends,
          }),
        },
      ],
    ]

    const result = await applyGrant({
      userId: 'u1',
      tier: 'max',
      source: 'manual',
      reason: '  founding user comp  ',
      endsAt: ends,
      actorId: 'ops_1',
    })

    expect(inserts[0].values).toMatchObject({
      userId: 'u1',
      tier: 'max',
      source: 'manual',
      status: 'active',
      reason: 'founding user comp', // trimmed
      actorId: 'ops_1',
    })
    expect(upserts[0].values).toMatchObject({
      userId: 'u1',
      tier: 'max',
      grantId: 'grant-1',
    })
    expect(result).toMatchObject({ grantId: 'grant-1', deduplicated: false })
    expect(result.effective.tier).toBe('max')
  })

  it('reports the tier the user ends up on, which need not be the tier granted', async () => {
    // A Pro grant lands on a user who already holds a perpetual Max comp.
    selectQueue = [
      [
        liveGrant({ id: 'g-max', tier: 'max', source: 'manual', endsAt: null }),
        liveGrant({ id: 'g-pro', tier: 'pro', source: 'stripe' }),
      ],
    ]
    const result = await applyGrant({
      userId: 'u1',
      tier: 'pro',
      source: 'stripe',
      reason: 'checkout',
    })
    expect(result.effective.tier).toBe('max')
  })

  it('stores no expiry for a perpetual grant', async () => {
    selectQueue = [[]]
    await applyGrant({
      userId: 'u1',
      tier: 'pro',
      source: 'promo',
      reason: 'lifetime founder price',
      endsAt: null,
    })
    expect(inserts[0].values.endsAt).toBeNull()
  })

  describe('idempotency for the payment adapters', () => {
    it('writes nothing when an identical live grant already exists', async () => {
      const startsAt = new Date(Date.now() - HOUR)
      const endsAt = future()
      const existing = liveGrant({
        id: 'sub-grant',
        tier: 'pro',
        startsAt,
        endsAt,
      })
      // 1st select: the sourceRef lookup. 2nd: the reprojection read.
      selectQueue = [[existing], [existing]]

      const result = await applyGrant({
        userId: 'u1',
        tier: 'pro',
        source: 'stripe',
        sourceRef: 'sub_123',
        startsAt,
        endsAt,
        reason: 'stripe: invoice.paid',
      })

      expect(result.deduplicated).toBe(true)
      expect(result.grantId).toBe('sub-grant')
      expect(inserts).toHaveLength(0)
      expect(updates).toHaveLength(0)
      // The projection is still rewritten: a redelivery is a free chance to
      // heal a projection that drifted.
      expect(upserts).toHaveLength(1)
    })

    it('supersedes rather than edits when the same subscription changes terms', async () => {
      const existing = liveGrant({ id: 'sub-grant', tier: 'pro' })
      selectQueue = [[existing], [liveGrant({ id: 'grant-1', tier: 'max' })]]

      const result = await applyGrant({
        userId: 'u1',
        tier: 'max',
        source: 'stripe',
        sourceRef: 'sub_123',
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        reason: 'stripe: upgraded to Max',
      })

      expect(updates[0].set).toMatchObject({ status: 'revoked' })
      expect(updates[0].set.revokedReason).toMatch(/superseded/i)
      expect(inserts[0].values).toMatchObject({
        tier: 'max',
        sourceRef: 'sub_123',
      })
      expect(result.deduplicated).toBe(false)
    })

    it('does not dedupe a manual grant, which has no external counterpart', async () => {
      selectQueue = [[]]
      await applyGrant({
        userId: 'u1',
        tier: 'max',
        source: 'manual',
        reason: 'support',
      })
      // No sourceRef lookup happened — the only select was the reprojection.
      expect(inserts).toHaveLength(1)
      expect(inserts[0].values.sourceRef).toBeNull()
    })
  })
})

describe('revokeGrant', () => {
  it('refuses a revocation with no stated reason', async () => {
    await expect(revokeGrant({ grantId: 'g1', reason: '', actorId: 'ops_1' })).rejects.toThrow(
      /reason/,
    )
  })

  it('returns null for a grant that does not exist', async () => {
    selectQueue = [[]]
    expect(await revokeGrant({ grantId: 'nope', reason: 'typo', actorId: 'ops_1' })).toBeNull()
  })

  it('stamps the reason and the actor, and never deletes the row', async () => {
    selectQueue = [[{ userId: 'u1', status: 'active' }], [{ status: 'active' }], []]

    const result = await revokeGrant({
      grantId: 'g1',
      reason: '  refunded  ',
      actorId: 'ops_1',
    })

    expect(updates[0].set).toMatchObject({
      status: 'revoked',
      revokedReason: 'refunded',
      revokedByActorId: 'ops_1',
    })
    expect(result?.userId).toBe('u1')
    expect(result?.effective.tier).toBe('free')
  })

  it('leaves an already-revoked grant alone rather than overwriting the first reason', async () => {
    selectQueue = [[{ userId: 'u1', status: 'revoked' }], [{ status: 'revoked' }], []]
    await revokeGrant({
      grantId: 'g1',
      reason: 'second attempt',
      actorId: 'ops_2',
    })
    expect(updates).toHaveLength(0)
  })

  it('uncovers the tier underneath: revoking a comp can leave a paid grant standing', async () => {
    selectQueue = [
      [{ userId: 'u1', status: 'active' }],
      [{ status: 'active' }],
      [liveGrant({ id: 'g-pro', tier: 'pro', source: 'stripe' })],
    ]
    const result = await revokeGrant({
      grantId: 'g-comp',
      reason: 'comp ended',
      actorId: 'ops_1',
    })
    expect(result?.effective).toMatchObject({ tier: 'pro', source: 'stripe' })
  })
})

describe('getEntitlement', () => {
  it('is free when the user has no projection row', async () => {
    selectQueue = [[]]
    expect(await getEntitlement('u1')).toEqual({
      tier: 'free',
      source: null,
      expiresAt: null,
    })
  })

  it('reports the projected tier while it is still live', async () => {
    const expiresAt = future()
    selectQueue = [[{ tier: 'max', source: 'stripe', expiresAt }]]
    expect(await getEntitlement('u1')).toEqual({
      tier: 'max',
      source: 'stripe',
      expiresAt,
    })
  })

  // The reason the projection stores expires_at at all: nobody has to send an
  // event for a lapsed subscription to stop granting.
  it('drops an expired projection to free without anyone revoking it', async () => {
    selectQueue = [[{ tier: 'max', source: 'stripe', expiresAt: past() }]]
    expect(await getEntitlement('u1')).toMatchObject({ tier: 'free' })
  })

  it('treats a perpetual projection as live forever', async () => {
    selectQueue = [[{ tier: 'pro', source: 'promo', expiresAt: null }]]
    expect(await getEntitlement('u1')).toMatchObject({ tier: 'pro' })
  })

  // Fails to free, not open and not throwing: a database blip must neither
  // hand out the coach nor stop someone logging a workout.
  it('degrades to free when the database is unreachable', async () => {
    selectThrows = true
    expect(await getEntitlement('u1')).toEqual({
      tier: 'free',
      source: null,
      expiresAt: null,
    })
  })
})

describe('the gates every call site uses', () => {
  it('grants coach on max and withholds it on pro', async () => {
    selectQueue = [[{ tier: 'max', source: 'stripe', expiresAt: null }]]
    expect(await hasFeature('u1', 'coach')).toBe(true)
    selectQueue = [[{ tier: 'pro', source: 'stripe', expiresAt: null }]]
    expect(await hasFeature('u1', 'coach')).toBe(false)
  })

  it('withholds every paid feature when the database is down', async () => {
    selectThrows = true
    expect(await hasFeature('u1', 'coach')).toBe(false)
  })

  it('withholds autoreg too when the database is down', async () => {
    selectThrows = true
    expect(await hasFeature('u1', 'autoreg')).toBe(false)
  })
})

describe('listGrants', () => {
  it('returns the whole ledger, revoked rows included', async () => {
    selectQueue = [[liveGrant({ id: 'g2' }), liveGrant({ id: 'g1', status: 'revoked' })]]
    const rows = await listGrants('u1')
    expect(rows.map((r) => r.id)).toEqual(['g2', 'g1'])
  })
})

describe('the enforcement boundary', () => {
  test('requireFeature passes silently for an entitled user', async () => {
    selectQueue = [[{ tier: 'max', source: 'stripe', expiresAt: null }]]
    await expect(requireFeature('u1', 'coach')).resolves.toBeUndefined()
  })

  // The error has to name the plan that says yes — "no" alone cannot be
  // rendered as an upgrade prompt.
  test('requireFeature names the feature and the tier that would grant it', async () => {
    selectQueue = [[{ tier: 'free', source: null, expiresAt: null }]]
    await expect(requireFeature('u1', 'coach')).rejects.toThrow(FeatureRequiredError)

    selectQueue = [[{ tier: 'free', source: null, expiresAt: null }]]
    const error = await requireFeature('u1', 'coach').catch((e) => e)
    expect(error.feature).toBe('coach')
    expect(error.requiredTier).toBe('max')
  })

  test('pro is refused coach but allowed autoreg', async () => {
    selectQueue = [[{ tier: 'pro', source: 'stripe', expiresAt: null }]]
    await expect(requireFeature('u1', 'coach')).rejects.toThrow(FeatureRequiredError)
    selectQueue = [[{ tier: 'pro', source: 'stripe', expiresAt: null }]]
    await expect(requireFeature('u1', 'autoreg')).resolves.toBeUndefined()
  })

  // A database fault degrades to Free, so the boundary CLOSES rather than
  // opening — the same direction as every other read here.
  test('refuses a paid feature when the entitlement read fails', async () => {
    selectThrows = true
    await expect(requireFeature('u1', 'autoreg')).rejects.toThrow(FeatureRequiredError)
  })
})

