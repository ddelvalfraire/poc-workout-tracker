import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'

/**
 * The self-serve sync is a public HTTP endpoint like every server action.
 * What matters: it only ever acts on the SESSION user (no target parameter
 * exists to abuse), it reports unavailable rather than throwing, and it is
 * env-gated exactly like the rest of the RC adapter.
 */
let sessionUserId = 'user_01SELF'
vi.mock('@/lib/auth', () => ({ requireUserId: async () => sessionUserId }))
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

import { syncMyRcEntitlementsAction } from './actions'

beforeEach(() => {
  sessionUserId = 'user_01SELF'
  projected.length = 0
  projectThrows = false
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
})
