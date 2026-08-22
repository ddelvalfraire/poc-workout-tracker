import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const listVendorGrantUserIds = vi.fn()
const projectFromVendor = vi.fn()
vi.mock('@/db/billing', () => ({
  listVendorGrantUserIds: (...args: unknown[]) => listVendorGrantUserIds(...args),
  projectFromVendor: (...args: unknown[]) => projectFromVendor(...args),
}))

const listReprocessable = vi.fn()
const markProcessed = vi.fn()
const markIgnored = vi.fn()
const markOrphaned = vi.fn()
const markFailed = vi.fn()
const trimPayloads = vi.fn()
const countDeadLetters = vi.fn()
vi.mock('@/db/rc-webhook-events', () => ({
  listReprocessable: (...args: unknown[]) => listReprocessable(...args),
  markProcessed: (...args: unknown[]) => markProcessed(...args),
  markIgnored: (...args: unknown[]) => markIgnored(...args),
  markOrphaned: (...args: unknown[]) => markOrphaned(...args),
  markFailed: (...args: unknown[]) => markFailed(...args),
  trimPayloads: (...args: unknown[]) => trimPayloads(...args),
  countDeadLetters: (...args: unknown[]) => countDeadLetters(...args),
}))

const fetchCustomerSnapshot = vi.fn()
vi.mock('./client', () => ({
  fetchCustomerSnapshot: (...args: unknown[]) => fetchCustomerSnapshot(...args),
}))

const processRcEvent = vi.fn()
vi.mock('./processor', () => ({
  processRcEvent: (...args: unknown[]) => processRcEvent(...args),
}))

import { reconcileRevenueCat } from './reconcile'

const NOW = new Date('2026-08-21T13:30:00Z')

function inboxRow(over: Record<string, unknown> = {}) {
  return {
    id: 'evt-stale-1',
    type: 'INITIAL_PURCHASE',
    appUserId: 'user_01SYNTHETIC',
    environment: 'PRODUCTION',
    payload: {
      api_version: '1.0',
      event: {
        id: 'evt-stale-1',
        type: 'INITIAL_PURCHASE',
        environment: 'PRODUCTION',
        app_user_id: 'user_01SYNTHETIC',
      },
    },
    status: 'failed',
    attempts: 6,
    lastError: 'RC API 503',
    receivedAt: new Date('2026-08-20T00:00:00Z'),
    processedAt: null,
    ...over,
  }
}

beforeEach(() => {
  listVendorGrantUserIds.mockReset().mockResolvedValue([])
  projectFromVendor.mockReset().mockResolvedValue({ tier: 'max' })
  listReprocessable.mockReset().mockResolvedValue([])
  markProcessed.mockReset().mockResolvedValue(undefined)
  markIgnored.mockReset().mockResolvedValue(undefined)
  markOrphaned.mockReset().mockResolvedValue(undefined)
  markFailed.mockReset().mockResolvedValue(undefined)
  trimPayloads.mockReset().mockResolvedValue(0)
  countDeadLetters.mockReset().mockResolvedValue({ failed: 0, orphaned: 0 })
  processRcEvent.mockReset().mockResolvedValue({ kind: 'processed' })
  vi.stubEnv('RC_API_V2_KEY', 'sk_test_synthetic')
  vi.stubEnv('RC_PROJECT_ID', 'proj_synthetic')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('reconcileRevenueCat', () => {
  it('returns null and touches nothing when the adapter is unconfigured', async () => {
    vi.stubEnv('RC_API_V2_KEY', '')
    expect(await reconcileRevenueCat(NOW)).toBeNull()
    expect(listVendorGrantUserIds).not.toHaveBeenCalled()
  })

  it('re-projects every RC-granted user, and one failure does not abort the sweep', async () => {
    listVendorGrantUserIds.mockResolvedValue(['user_01A', 'user_01B', 'user_01C'])
    projectFromVendor
      .mockResolvedValueOnce({ tier: 'max' })
      .mockRejectedValueOnce(new Error('RC API 503'))
      .mockResolvedValueOnce({ tier: 'pro' })

    const report = await reconcileRevenueCat(NOW)
    expect(report).toMatchObject({ swept: 2, sweepFailures: 1 })
    expect(projectFromVendor).toHaveBeenCalledTimes(3)
  })

  it('reprocesses a failed inbox row to its terminal state', async () => {
    listReprocessable.mockResolvedValue([inboxRow({})])
    const report = await reconcileRevenueCat(NOW)
    expect(processRcEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'evt-stale-1', type: 'INITIAL_PURCHASE' }),
    )
    expect(markProcessed).toHaveBeenCalledWith('evt-stale-1')
    expect(report).toMatchObject({ reprocessed: 1, reprocessFailures: 0 })
  })

  it('asks for rows stale before now minus the in-flight window', async () => {
    await reconcileRevenueCat(NOW)
    const arg = listReprocessable.mock.calls[0][0] as { staleReceivedBefore: Date }
    expect(arg.staleReceivedBefore.getTime()).toBe(NOW.getTime() - 3 * 60 * 60 * 1000)
  })

  it('orphans a row whose payload is gone (trimmed) instead of crashing', async () => {
    listReprocessable.mockResolvedValue([inboxRow({ payload: null })])
    const report = await reconcileRevenueCat(NOW)
    expect(markOrphaned).toHaveBeenCalledWith(
      'evt-stale-1',
      'payload unavailable for reprocessing',
    )
    expect(processRcEvent).not.toHaveBeenCalled()
    expect(report).toMatchObject({ reprocessed: 1 })
  })

  it('keeps a still-failing row in the dead-letter view', async () => {
    listReprocessable.mockResolvedValue([inboxRow({})])
    processRcEvent.mockResolvedValue({ kind: 'retryable', error: 'still down' })
    const report = await reconcileRevenueCat(NOW)
    expect(markFailed).toHaveBeenCalledWith('evt-stale-1', 'still down')
    expect(report).toMatchObject({ reprocessed: 0, reprocessFailures: 1 })
  })

  it('trims payloads older than the retention window and reports dead letters', async () => {
    trimPayloads.mockResolvedValue(4)
    countDeadLetters.mockResolvedValue({ failed: 2, orphaned: 1 })
    const report = await reconcileRevenueCat(NOW)
    const trimArg = trimPayloads.mock.calls[0][0] as Date
    expect(trimArg.getTime()).toBe(NOW.getTime() - 90 * 24 * 60 * 60 * 1000)
    expect(report).toMatchObject({ trimmedPayloads: 4, deadLetters: { failed: 2, orphaned: 1 } })
  })
})
