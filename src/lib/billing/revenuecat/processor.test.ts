import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RcEvent } from './types'

const projectFromVendor = vi.fn()
vi.mock('@/db/billing', () => ({
  projectFromVendor: (...args: unknown[]) => projectFromVendor(...args),
}))

const fetchCustomerSnapshot = vi.fn()
vi.mock('./client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./client')>()
  return {
    RetryableBillingError: original.RetryableBillingError,
    fetchCustomerSnapshot: (...args: unknown[]) => fetchCustomerSnapshot(...args),
  }
})

import { processRcEvent } from './processor'
import { RetryableBillingError } from './client'

function event(over: Partial<RcEvent>): RcEvent {
  return {
    id: 'evt-synthetic-1',
    type: 'INITIAL_PURCHASE',
    environment: 'PRODUCTION',
    app_user_id: 'user_01SYNTHETIC',
    ...over,
  }
}

beforeEach(() => {
  projectFromVendor.mockReset().mockResolvedValue({ tier: 'max' })
  fetchCustomerSnapshot.mockReset()
})

describe('processRcEvent', () => {
  it('re-projects the affected user through projectFromVendor with the RC fetcher', async () => {
    const outcome = await processRcEvent(event({}))
    expect(outcome).toEqual({ kind: 'processed' })
    expect(projectFromVendor).toHaveBeenCalledTimes(1)
    const [userId, source, fetcher] = projectFromVendor.mock.calls[0]
    expect(userId).toBe('user_01SYNTHETIC')
    expect(source).toBe('revenuecat')
    // The fetcher closes over the SAME user — projectFromVendor's identity
    // check depends on it.
    await (fetcher as () => Promise<unknown>)()
    expect(fetchCustomerSnapshot).toHaveBeenCalledWith('user_01SYNTHETIC')
  })

  it('ignores log-only events without touching the store', async () => {
    const outcome = await processRcEvent(event({ type: 'CANCELLATION' }))
    expect(outcome).toEqual({ kind: 'ignored' })
    expect(projectFromVendor).not.toHaveBeenCalled()
  })

  it('orphans events it cannot resolve to a user', async () => {
    const outcome = await processRcEvent(
      event({ app_user_id: '$RCAnonymousID:abc', aliases: [] }),
    )
    expect(outcome.kind).toBe('orphaned')
    expect(projectFromVendor).not.toHaveBeenCalled()
  })

  it('TRANSFER re-projects every resolvable user on both sides', async () => {
    const outcome = await processRcEvent(
      event({
        type: 'TRANSFER',
        app_user_id: undefined,
        transferred_from: ['user_01LOSER'],
        transferred_to: ['user_01WINNER'],
      }),
    )
    expect(outcome).toEqual({ kind: 'processed' })
    expect(projectFromVendor.mock.calls.map((c) => c[0])).toEqual([
      'user_01LOSER',
      'user_01WINNER',
    ])
  })

  it('maps a RetryableBillingError to a retryable outcome', async () => {
    projectFromVendor.mockRejectedValue(new RetryableBillingError('RC API 503'))
    const outcome = await processRcEvent(event({}))
    expect(outcome).toEqual({ kind: 'retryable', error: 'RC API 503' })
  })

  it('treats any other throw as retryable too — a DB blip must not become a silent 200', async () => {
    projectFromVendor.mockRejectedValue(new Error('connection reset'))
    const outcome = await processRcEvent(event({}))
    expect(outcome.kind).toBe('retryable')
  })
})
