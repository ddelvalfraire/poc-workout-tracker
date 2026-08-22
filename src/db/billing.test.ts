import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EntitlementSnapshot } from '@/lib/billing/snapshot'

/**
 * projectFromVendor's guardrails, with the transactional collaborators
 * mocked. The point of interest is the M1 freeze: an unknown customer with a
 * live grant must NOT revoke.
 */
const lockUserInTx = vi.fn(async () => {})
const listLiveGrantsInTx = vi.fn(async (): Promise<unknown[]> => [])
const applyGrantInTx = vi.fn(async () => ({ grantId: 'g', deduplicated: false }))
const revokeGrantInTx = vi.fn(async () => {})
const reprojectInTx = vi.fn(async () => ({ tier: 'free', source: null, expiresAt: null }))

// The wrappers drop args deliberately — these tests assert call counts and
// the freeze/mismatch control flow, not the arguments threaded through.
vi.mock('./entitlements', () => ({
  lockUserInTx: () => lockUserInTx(),
  listLiveGrantsInTx: () => listLiveGrantsInTx(),
  applyGrantInTx: () => applyGrantInTx(),
  revokeGrantInTx: () => revokeGrantInTx(),
  reprojectInTx: () => reprojectInTx(),
}))

vi.mock('./index', () => ({
  // Run the callback with a dummy tx; a thrown callback rejects, as a real
  // transaction would roll back and rethrow.
  db: { transaction: (fn: (tx: unknown) => unknown) => fn({}) },
}))

import { projectFromVendor } from './billing'

function snapshot(over: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot {
  return { userId: 'user_01A', source: 'revenuecat', entitlements: [], ...over }
}

const liveGrant = { id: 'grant-1', sourceRef: 'user_01A:max', endsAt: new Date(Date.now() + 1e9) }

beforeEach(() => {
  lockUserInTx.mockClear()
  listLiveGrantsInTx.mockReset().mockResolvedValue([])
  applyGrantInTx.mockClear()
  revokeGrantInTx.mockClear()
  reprojectInTx.mockClear()
})

describe('projectFromVendor', () => {
  it('FREEZES (throws, no revoke) when the customer is unknown but a live grant exists — M1', async () => {
    listLiveGrantsInTx.mockResolvedValue([liveGrant])
    await expect(
      projectFromVendor('user_01A', 'revenuecat', async () => snapshot({ customerKnown: false })),
    ).rejects.toThrow(/customer unknown/)
    expect(revokeGrantInTx).not.toHaveBeenCalled()
  })

  it('an unknown customer with NO live grant is a harmless no-op (free user)', async () => {
    listLiveGrantsInTx.mockResolvedValue([])
    await expect(
      projectFromVendor('user_01A', 'revenuecat', async () => snapshot({ customerKnown: false })),
    ).resolves.toBeDefined()
    expect(revokeGrantInTx).not.toHaveBeenCalled()
  })

  it('a KNOWN customer with an empty snapshot revokes the live grant — the normal cancel path', async () => {
    listLiveGrantsInTx.mockResolvedValue([liveGrant])
    await projectFromVendor('user_01A', 'revenuecat', async () => snapshot({ customerKnown: true }))
    expect(revokeGrantInTx).toHaveBeenCalledTimes(1)
  })

  it('a snapshot with no customerKnown flag defaults to known (revokes) — back-compat', async () => {
    listLiveGrantsInTx.mockResolvedValue([liveGrant])
    await projectFromVendor('user_01A', 'revenuecat', async () => snapshot())
    expect(revokeGrantInTx).toHaveBeenCalledTimes(1)
  })

  it('rejects a fetcher that returns a mismatched identity', async () => {
    await expect(
      projectFromVendor('user_01A', 'revenuecat', async () => snapshot({ userId: 'user_01B' })),
    ).rejects.toThrow(/identity mismatch/)
  })
})
