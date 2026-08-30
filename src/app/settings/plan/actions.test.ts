import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'

/**
 * The self-serve sync is a public HTTP endpoint like every server action.
 * What matters: it only ever acts on the SESSION user (no target parameter
 * exists to abuse), it reports unavailable rather than throwing, and it is
 * env-gated exactly like the rest of the RC adapter.
 */
let sessionUserId = 'user_01SELF'
vi.mock('@/lib/auth/auth', () => ({ requireUserId: async () => sessionUserId }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const projected: unknown[] = []
let projectThrows = false
vi.mock('@/db/billing', () => ({
  projectFromVendor: async (userId: string, source: string) => {
    if (projectThrows) throw new Error('RC API 503')
    projected.push({ userId, source })
    return { tier: 'pro', source: 'revenuecat', expiresAt: null }
  },
}))

vi.mock('@/lib/billing/revenuecat/client', () => ({
  fetchCustomerSnapshot: async () => ({ userId: 'unused', source: 'revenuecat', entitlements: [] }),
}))

let redisSetResult: string | null = 'OK'
const redisSet = vi.fn(async () => redisSetResult)
let redisAvailable = false
vi.mock('@/lib/redis', () => ({
  getRedis: () => (redisAvailable ? { set: redisSet } : null),
}))

vi.mock('@/db/entitlements', () => ({
  getEntitlement: async () => ({ tier: 'max', source: 'revenuecat', expiresAt: null }),
}))

import { syncMyRcEntitlementsAction } from './actions'

beforeEach(() => {
  sessionUserId = 'user_01SELF'
  projected.length = 0
  projectThrows = false
  redisAvailable = false
  redisSetResult = 'OK'
  redisSet.mockClear()
  vi.stubEnv('RC_API_V2_KEY', 'sk_test_synthetic')
  vi.stubEnv('RC_PROJECT_ID', 'proj_synthetic')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('syncMyRcEntitlementsAction', () => {
  test('re-projects the SESSION user — there is no way to name someone else', async () => {
    expect(await syncMyRcEntitlementsAction()).toEqual({ status: 'synced', tier: 'pro' })
    expect(projected).toEqual([{ userId: 'user_01SELF', source: 'revenuecat' }])
  })

  test('reports unavailable when the adapter is unconfigured', async () => {
    vi.stubEnv('RC_API_V2_KEY', '')
    expect(await syncMyRcEntitlementsAction()).toEqual({ status: 'unavailable' })
    expect(projected).toHaveLength(0)
  })

  test('maps a projection failure to unavailable, never a throw — the webhook still delivers the purchase', async () => {
    projectThrows = true
    expect(await syncMyRcEntitlementsAction()).toEqual({ status: 'unavailable' })
  })

  test('inside the cooldown it answers from OUR store without spending RC budget', async () => {
    redisAvailable = true
    redisSetResult = null // marker already claimed
    expect(await syncMyRcEntitlementsAction()).toEqual({ status: 'synced', tier: 'max' })
    expect(projected).toHaveLength(0)
  })

  test('claims the cooldown marker before the first RC call', async () => {
    redisAvailable = true
    expect(await syncMyRcEntitlementsAction()).toEqual({ status: 'synced', tier: 'pro' })
    expect(redisSet).toHaveBeenCalledWith('rcsync:user_01SELF', '1', { nx: true, ex: 30 })
    expect(projected).toHaveLength(1)
  })
})
