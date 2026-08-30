import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}))
vi.mock('@/db/push-subscriptions', () => ({
  listPushSubscriptions: vi.fn(),
  deletePushSubscriptionByEndpoint: vi.fn(),
}))

import webpush from 'web-push'
import {
  listPushSubscriptions,
  deletePushSubscriptionByEndpoint,
} from '@/db/push-subscriptions'
import { sendPushToUser, resetPushConfigForTests } from './push'

const mockedSend = vi.mocked(webpush.sendNotification)
const mockedList = vi.mocked(listPushSubscriptions)
const mockedPrune = vi.mocked(deletePushSubscriptionByEndpoint)

const USER = 'user_123'
const PAYLOAD = { title: 'Legs — Week 3', body: '5 exercises · tap to start', url: '/' }

function sub(n: number) {
  return {
    id: `id-${n}`,
    endpoint: `https://push.example.com/sub/${n}`,
    p256dh: 'BKey',
    auth: 'Auth',
  }
}

/** A web-push style delivery error carrying an HTTP status. */
function statusError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(`status ${statusCode}`), { statusCode })
}

function configureVapid(): void {
  vi.stubEnv('VAPID_PUBLIC_KEY', 'BPub')
  vi.stubEnv('VAPID_PRIVATE_KEY', 'priv')
  vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.com')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  resetPushConfigForTests()
  mockedPrune.mockResolvedValue()
})

describe('sendPushToUser', () => {
  it('reports unconfigured (and sends nothing) when VAPID env is missing', async () => {
    // Act
    const result = await sendPushToUser(USER, PAYLOAD)

    // Assert
    expect(result).toEqual({ configured: false, sent: 0, pruned: 0, failed: 0 })
    expect(mockedList).not.toHaveBeenCalled()
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('sends the payload to every subscription', async () => {
    // Arrange
    configureVapid()
    mockedList.mockResolvedValue([sub(1), sub(2)])
    mockedSend.mockResolvedValue({} as Awaited<ReturnType<typeof webpush.sendNotification>>)

    // Act
    const result = await sendPushToUser(USER, PAYLOAD)

    // Assert
    expect(result).toEqual({ configured: true, sent: 2, pruned: 0, failed: 0 })
    expect(mockedSend).toHaveBeenCalledTimes(2)
    expect(mockedSend).toHaveBeenCalledWith(
      { endpoint: sub(1).endpoint, keys: { p256dh: 'BKey', auth: 'Auth' } },
      JSON.stringify(PAYLOAD),
    )
  })

  it('prunes the row on 410 and still sends to the others', async () => {
    // Arrange
    configureVapid()
    mockedList.mockResolvedValue([sub(1), sub(2)])
    mockedSend
      .mockRejectedValueOnce(statusError(410))
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof webpush.sendNotification>>)

    // Act
    const result = await sendPushToUser(USER, PAYLOAD)

    // Assert
    expect(result).toEqual({ configured: true, sent: 1, pruned: 1, failed: 0 })
    expect(mockedPrune).toHaveBeenCalledWith(sub(1).endpoint)
  })

  it('prunes on 404 too', async () => {
    configureVapid()
    mockedList.mockResolvedValue([sub(1)])
    mockedSend.mockRejectedValueOnce(statusError(404))

    const result = await sendPushToUser(USER, PAYLOAD)

    expect(result.pruned).toBe(1)
    expect(mockedPrune).toHaveBeenCalledWith(sub(1).endpoint)
  })

  it('fails soft (no prune, no throw) on other errors', async () => {
    // Arrange
    configureVapid()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedList.mockResolvedValue([sub(1), sub(2)])
    mockedSend
      .mockRejectedValueOnce(statusError(500))
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof webpush.sendNotification>>)

    // Act
    const result = await sendPushToUser(USER, PAYLOAD)

    // Assert
    expect(result).toEqual({ configured: true, sent: 1, pruned: 0, failed: 1 })
    expect(mockedPrune).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
