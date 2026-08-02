import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Chain mock for the cross-user aggregates. Every db.select()... builder is
 * thenable and resolves the next queued result in call order (the Promise.all
 * array order in getAppVitals). `shouldThrow` forces the unavailable path.
 */
const state = vi.hoisted(() => ({ queue: [] as unknown[][], shouldThrow: false }))

vi.mock('@/db', () => {
  const makeChain = () => {
    if (state.shouldThrow) throw new Error('db down')
    const obj: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'orderBy', 'limit']) {
      obj[method] = () => obj
    }
    obj.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(state.queue.shift() ?? []).then(resolve)
    return obj
  }
  return { db: { select: () => makeChain() } }
})

import { getAppVitals } from './app-vitals'

beforeEach(() => {
  state.queue = []
  state.shouldThrow = false
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getAppVitals', () => {
  it('maps every count and the recent-events slice', async () => {
    const occurredAt = new Date('2026-08-01T10:00:00Z')
    state.queue = [
      [{ value: 12 }], // workouts completed 7d
      [{ value: 4 }], // distinct active users 7d
      [{ value: 9 }], // push subscriptions
      [{ value: 3 }], // active goals
      [{ value: 1 }], // pending proposals
      [{ actor: 'coach', summary: 'Adjusted week 2 volume', occurredAt }], // recent events
    ]

    const result = await getAppVitals()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toMatchObject({
        workoutsCompleted7d: 12,
        activeUsers7d: 4,
        pushSubscriptions: 9,
        activeGoals: 3,
        pendingProposals: 1,
      })
      expect(result.data.recentEvents).toHaveLength(1)
      expect(result.data.recentEvents[0]).toMatchObject({ actor: 'coach' })
    }
  })

  it('defaults counts to 0 when a query returns no rows', async () => {
    state.queue = [[], [], [], [], [], []]
    const result = await getAppVitals()
    expect(result.ok && result.data.workoutsCompleted7d).toBe(0)
    expect(result.ok && result.data.recentEvents).toEqual([])
  })

  it("returns 'unavailable' when the database throws", async () => {
    state.shouldThrow = true
    expect(await getAppVitals()).toEqual({ ok: false, reason: 'unavailable' })
  })
})
