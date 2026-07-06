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
  it('reports failed on rejection and retries after retryMs until it lands', async () => {
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

    // First retry also fails
    await tick(RETRY)
    expect(send).toHaveBeenCalledTimes(2)
    expect(statuses.at(-1)).toBe('failed')

    // Second retry lands
    await tick(RETRY)
    expect(send).toHaveBeenCalledTimes(3)
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
