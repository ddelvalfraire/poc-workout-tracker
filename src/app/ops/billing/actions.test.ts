import { describe, expect, test, vi, beforeEach } from 'vitest'

/**
 * These actions are separately reachable HTTP endpoints, not private helpers
 * of the page that renders their form. The tests that matter most are the
 * ones proving they refuse a caller off the ops allowlist and never let one
 * choose whose name goes in the ledger.
 */
let sessionUserId = 'user_ops'
let opsMembers = new Set(['user_ops'])

vi.mock('@/lib/auth', () => ({ requireUserId: async () => sessionUserId }))
vi.mock('@/lib/ops/access', () => ({ isOpsUser: (id: string) => opsMembers.has(id) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const applied: unknown[] = []
const revoked: unknown[] = []
let revokeReturns: unknown = { userId: 'user_target', effective: { tier: 'free' } }

vi.mock('@/db/entitlements', () => ({
  applyGrant: async (input: unknown) => {
    applied.push(input)
    return { grantId: 'g1', effective: { tier: 'max', source: 'manual', expiresAt: null } }
  },
  revokeGrant: async (input: unknown) => {
    revoked.push(input)
    return revokeReturns
  },
}))

import { grantTierAction, revokeGrantAction } from './actions'
import { MAX_GRANT_REASON_LENGTH, MIN_GRANT_REASON_LENGTH } from '@/lib/entitlements/duration'

const VALID = {
  userId: 'user_target',
  tier: 'max',
  duration: '30d',
  reason: 'Refund make-good for #1183',
}

beforeEach(() => {
  sessionUserId = 'user_ops'
  opsMembers = new Set(['user_ops'])
  applied.length = 0
  revoked.length = 0
  revokeReturns = { userId: 'user_target', effective: { tier: 'free' } }
})

describe('grantTierAction', () => {
  test('refuses a caller who is not on the ops allowlist, and writes nothing', async () => {
    sessionUserId = 'user_stranger'
    expect(await grantTierAction(VALID)).toEqual({ status: 'denied' })
    expect(applied).toHaveLength(0)
  })

  test('refuses everyone when the allowlist is empty', async () => {
    opsMembers = new Set()
    expect(await grantTierAction(VALID)).toEqual({ status: 'denied' })
    expect(applied).toHaveLength(0)
  })

  test('grants and reports the tier the member ends up on', async () => {
    expect(await grantTierAction(VALID)).toEqual({ status: 'granted', tier: 'max' })
    expect(applied).toHaveLength(1)
  })

  // The actor is the session's own id and is not part of the input, so a
  // forged request cannot attribute a comp to somebody else.
  test('records the session user as the actor', async () => {
    await grantTierAction(VALID)
    expect(applied[0]).toMatchObject({ actorId: 'user_ops' })
  })

  /**
   * A hand grant must never look like a subscription: the payment adapters
   * key idempotency on (source, sourceRef), so a manual row wearing
   * source 'stripe' would make a real webhook silently deduplicate against it.
   */
  test('always writes source manual, never a payment source', async () => {
    await grantTierAction(VALID)
    expect(applied[0]).toMatchObject({ source: 'manual' })
    expect(applied[0]).not.toHaveProperty('sourceRef')
  })

  test('rejects a tier that is not one we sell', async () => {
    expect(await grantTierAction({ ...VALID, tier: 'enterprise' })).toEqual({
      status: 'invalid',
      field: 'tier',
    })
    expect(applied).toHaveLength(0)
  })

  test('rejects a duration outside the fixed set', async () => {
    expect(await grantTierAction({ ...VALID, duration: '99y' })).toEqual({
      status: 'invalid',
      field: 'duration',
    })
  })

  test('rejects an empty target user', async () => {
    expect(await grantTierAction({ ...VALID, userId: '  ' })).toEqual({
      status: 'invalid',
      field: 'user',
    })
  })

  test('accepts a reason exactly at the shared floor, and refuses one below it', async () => {
    const atFloor = 'x'.repeat(MIN_GRANT_REASON_LENGTH)
    expect(await grantTierAction({ ...VALID, reason: atFloor })).toMatchObject({
      status: 'granted',
    })
    applied.length = 0
    const belowFloor = 'x'.repeat(MIN_GRANT_REASON_LENGTH - 1)
    expect(await grantTierAction({ ...VALID, reason: belowFloor })).toEqual({
      status: 'invalid',
      field: 'reason',
    })
    expect(applied).toHaveLength(0)
  })

  // The column is unbounded text; nothing else stops a paste.
  test('refuses a reason past the upper bound', async () => {
    const tooLong = 'x'.repeat(MAX_GRANT_REASON_LENGTH + 1)
    expect(await grantTierAction({ ...VALID, reason: tooLong })).toEqual({
      status: 'invalid',
      field: 'reason',
    })
    expect(applied).toHaveLength(0)
  })

  test('rejects a reason too short to mean anything later', async () => {
    expect(await grantTierAction({ ...VALID, reason: 'x' })).toEqual({
      status: 'invalid',
      field: 'reason',
    })
    expect(applied).toHaveLength(0)
  })

  test('turns a fixed duration into a real end date', async () => {
    await grantTierAction({ ...VALID, duration: '30d' })
    const { startsAt, endsAt } = applied[0] as { startsAt: Date; endsAt: Date }
    expect(endsAt.getTime() - startsAt.getTime()).toBe(30 * 86_400_000)
  })

  test('passes no end date at all for a perpetual grant', async () => {
    await grantTierAction({ ...VALID, duration: 'forever' })
    expect((applied[0] as { endsAt: Date | null }).endsAt).toBeNull()
  })
})

describe('revokeGrantAction', () => {
  test('refuses a caller who is not on the ops allowlist', async () => {
    sessionUserId = 'user_stranger'
    expect(await revokeGrantAction({ grantId: 'g1', reason: 'refunded' })).toEqual({
      status: 'denied',
    })
    expect(revoked).toHaveLength(0)
  })

  test('rejects a revocation with no usable reason', async () => {
    expect(await revokeGrantAction({ grantId: 'g1', reason: ' ' })).toEqual({
      status: 'invalid',
      field: 'reason',
    })
    expect(revoked).toHaveLength(0)
  })

  test('records the session user as the revoking actor', async () => {
    await revokeGrantAction({ grantId: 'g1', reason: 'refunded on request' })
    expect(revoked[0]).toMatchObject({ actorId: 'user_ops', grantId: 'g1' })
  })

  test('reports a grant that does not exist rather than claiming success', async () => {
    revokeReturns = null
    expect(await revokeGrantAction({ grantId: 'nope', reason: 'typo' })).toEqual({
      status: 'notFound',
    })
  })
})
