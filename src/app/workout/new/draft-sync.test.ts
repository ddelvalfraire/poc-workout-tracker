import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDraftSyncQueue, type DraftSyncStatus } from './draft-sync'
import type { DraftPayload } from './draft-payload'

/**
 * The queue is pure logic with injectable async work, driven here by vitest's
 * fake timers — no React, no network. `send`/`remove` resolve or reject per
 * test to simulate the server action succeeding or the gym dead zone.
 */

const PAYLOAD_A = { v: 1, unit: 'kg', name: 'A', openedAt: '2026-07-05T11:40:00.000Z' } as unknown as DraftPayload
const PAYLOAD_B = { v: 1, unit: 'kg', name: 'B', openedAt: '2026-07-05T11:40:00.000Z' } as unknown as DraftPayload

const DEBOUNCE = 800
const RETRY = 5_000

let statuses: DraftSyncStatus[]

function makeQueue(overrides: {
  send?: (payload: DraftPayload) => Promise<void>
  remove?: () => Promise<void>
} = {}) {
  const send = overrides.send ?? vi.fn().mockResolvedValue(undefined)
  const remove = overrides.remove ?? vi.fn().mockResolvedValue(undefined)
  const queue = createDraftSyncQueue({
    send,
    remove,
    onStatus: (s) => statuses.push(s),
    debounceMs: DEBOUNCE,
    retryMs: RETRY,
  })
  return { queue, send: vi.mocked(send), remove: vi.mocked(remove) }
}

/** Runs pending timers AND lets in-flight promises settle. */
async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  statuses = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('debounce and success path', () => {
  it('coalesces a burst of enqueues into one send of the latest payload', async () => {
    // Arrange
    const { queue, send } = makeQueue()

    // Act — two changes inside one debounce window
    queue.enqueue(PAYLOAD_A)
    await tick(DEBOUNCE / 2)
    queue.enqueue(PAYLOAD_B)
    await tick(DEBOUNCE)

    // Assert — one wire call, latest value
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(PAYLOAD_B)
    expect(statuses.at(-1)).toBe('synced')
  })

  it('reports pending while waiting and synced after the send lands', async () => {
    const { queue } = makeQueue()

    queue.enqueue(PAYLOAD_A)
    expect(statuses.at(-1)).toBe('pending')

    await tick(DEBOUNCE)
    expect(statuses.at(-1)).toBe('synced')
  })

  it('sends remove for a null payload (draft cleared out)', async () => {
    const { queue, send, remove } = makeQueue()

    queue.enqueue(null)
    await tick(DEBOUNCE)

    expect(remove).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    expect(statuses.at(-1)).toBe('synced')
  })
})

describe('failure and retry', () => {
  it('retries with exponential backoff (base, 2x, ...) until it lands', async () => {
    // Arrange — two failures, then success
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    const { queue } = makeQueue({ send })

    // Act — initial attempt fails
    queue.enqueue(PAYLOAD_A)
    await tick(DEBOUNCE)
    expect(statuses.at(-1)).toBe('failed')

    // First retry fires after the base interval and also fails
    await tick(RETRY)
    expect(send).toHaveBeenCalledTimes(2)
    expect(statuses.at(-1)).toBe('failed')

    // Second retry backs off to 2x base: nothing at 1x...
    await tick(RETRY)
    expect(send).toHaveBeenCalledTimes(2)

    // ...fires at 2x, and lands
    await tick(RETRY)
    expect(send).toHaveBeenCalledTimes(3)
    expect(statuses.at(-1)).toBe('synced')
  })

  it('caps the backoff at retryMaxMs', async () => {
    // Arrange — always failing, cap at 2x base
    const send = vi.fn().mockRejectedValue(new Error('offline'))
    const remove = vi.fn().mockResolvedValue(undefined)
    const queue = createDraftSyncQueue({
      send,
      remove,
      onStatus: (s) => statuses.push(s),
      debounceMs: DEBOUNCE,
      retryMs: RETRY,
      retryMaxMs: RETRY * 2,
    })

    // Act — fail through several rounds: base, 2x, then capped at 2x forever
    queue.enqueue(PAYLOAD_A)
    await tick(DEBOUNCE) // attempt 1
    await tick(RETRY) // attempt 2 (base)
    await tick(RETRY * 2) // attempt 3 (2x)
    await tick(RETRY * 2) // attempt 4 (capped, NOT 4x)

    // Assert
    expect(send).toHaveBeenCalledTimes(4)
  })

  it('resets the backoff after a success', async () => {
    // Arrange — fail, succeed, fail again: the second failure retries at base
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    const { queue } = makeQueue({ send })

    queue.enqueue(PAYLOAD_A)
    await tick(DEBOUNCE) // fail #1
    await tick(RETRY) // success — backoff resets
    expect(statuses.at(-1)).toBe('synced')

    // Act — a new change fails once more
    queue.enqueue(PAYLOAD_B)
    await tick(DEBOUNCE) // fail #2
    await tick(RETRY) // must retry at BASE again, not 2x

    // Assert
    expect(send).toHaveBeenCalledTimes(4)
    expect(statuses.at(-1)).toBe('synced')
  })

  it('flush() attempts immediately without waiting for the retry timer', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const { queue } = makeQueue({ send })

    queue.enqueue(PAYLOAD_A)
    await tick(DEBOUNCE)
    expect(statuses.at(-1)).toBe('failed')

    // Act — the browser came back online
    queue.flush()
    await tick(0)

    // Assert — retried at once, no 5s wait
    expect(send).toHaveBeenCalledTimes(2)
    expect(statuses.at(-1)).toBe('synced')
  })

  it('a payload enqueued mid-flight is sent after the current attempt settles', async () => {
    // Arrange — a slow send we control
    let resolveFirst!: () => void
    const send = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValue(undefined)
    const { queue } = makeQueue({ send })

    // Act — first attempt goes in flight
    queue.enqueue(PAYLOAD_A)
    await tick(DEBOUNCE)
    expect(send).toHaveBeenCalledTimes(1)

    // A newer value arrives while the first is still on the wire
    queue.enqueue(PAYLOAD_B)
    resolveFirst()
    await tick(DEBOUNCE)

    // Assert — follow-up attempt carries the newer payload
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(PAYLOAD_B)
    expect(statuses.at(-1)).toBe('synced')
  })
})

describe('pause / resume (save in flight)', () => {
  it('pause blocks pending sends and retries; resume re-attempts the latest', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const { queue } = makeQueue({ send })

    // A failed sync is waiting on its retry timer
    queue.enqueue(PAYLOAD_A)
    await tick(DEBOUNCE)
    expect(statuses.at(-1)).toBe('failed')

    // Act — save starts; the retry window elapses while paused
    queue.pause()
    await tick(RETRY * 2)
    expect(send).toHaveBeenCalledTimes(1)

    // Save failed — resume picks the latest back up
    queue.resume()
    await tick(0)
    expect(send).toHaveBeenCalledTimes(2)
    expect(statuses.at(-1)).toBe('synced')
  })

  it('enqueue while paused does not send until resume', async () => {
    const { queue, send } = makeQueue()

    queue.pause()
    queue.enqueue(PAYLOAD_A)
    await tick(DEBOUNCE * 2)
    expect(send).not.toHaveBeenCalled()

    queue.resume()
    await tick(0)
    expect(send).toHaveBeenCalledWith(PAYLOAD_A)
  })
})

describe('settle (save-time barrier)', () => {
  it('pauses and resolves only after the in-flight attempt lands', async () => {
    // Arrange — a slow send we control
    let resolveSend!: () => void
    const send = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSend = resolve }))
    const { queue } = makeQueue({ send })

    // A put goes in flight
    queue.enqueue(PAYLOAD_A)
    await tick(DEBOUNCE)
    expect(send).toHaveBeenCalledTimes(1)

    // Act — save wants to start; settle must not resolve while on the wire
    let settled = false
    const settling = queue.settle().then(() => { settled = true })
    await tick(0)
    expect(settled).toBe(false)

    // The wire call lands → settle resolves, and nothing new is sent (paused)
    resolveSend()
    await settling
    await tick(DEBOUNCE * 2)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('resolves immediately when nothing is in flight', async () => {
    const { queue, send } = makeQueue()

    await queue.settle()

    expect(send).not.toHaveBeenCalled()
  })

  it('resolves even when the in-flight attempt fails, without scheduling a retry', async () => {
    // Arrange — a slow failing send
    let rejectSend!: (e: Error) => void
    const send = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectSend = reject }))
    const { queue } = makeQueue({ send })

    queue.enqueue(PAYLOAD_A)
    await tick(DEBOUNCE)

    // Act
    const settling = queue.settle()
    rejectSend(new Error('offline'))
    await settling

    // Assert — paused: the failure must not re-arm the retry timer
    await tick(RETRY * 4)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
