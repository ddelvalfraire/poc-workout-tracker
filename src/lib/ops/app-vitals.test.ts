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
    for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'leftJoin']) {
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
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-01T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('getAppVitals', () => {
  it('maps every count, both 14d series, and the feeds', async () => {
    const occurredAt = new Date('2026-08-01T10:00:00Z')
    const startedAt = new Date('2026-08-01T08:00:00Z')
    state.queue = [
      [{ value: 12 }], // workouts completed 7d
      [{ value: 4 }], // distinct active users 7d
      [{ value: 9 }], // push subscriptions
      [{ value: 3 }], // active goals
      [{ value: 1 }], // pending proposals
      [{ day: '2026-08-01', value: 2 }], // workouts per day (sparse)
      [{ day: '2026-07-31', value: 1 }], // active users per day (sparse)
      [{ actor: 'coach', summary: 'Adjusted week 2 volume', occurredAt }], // recent events
      [{ name: 'Push Day', startedAt, volumeKg: 5400 }], // recent workouts
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
      // Series come back dense: 14 ascending days, zero-filled around the data.
      expect(result.data.workoutsPerDay).toHaveLength(14)
      expect(result.data.workoutsPerDay[13]).toEqual({ day: '2026-08-01', value: 2 })
      expect(result.data.workoutsPerDay[12]).toEqual({ day: '2026-07-31', value: 0 })
      expect(result.data.activeUsersPerDay).toHaveLength(14)
      expect(result.data.activeUsersPerDay[12]).toEqual({ day: '2026-07-31', value: 1 })
      expect(result.data.recentEvents).toHaveLength(1)
      expect(result.data.recentEvents[0]).toMatchObject({ actor: 'coach' })
      expect(result.data.recentWorkouts).toEqual([{ name: 'Push Day', startedAt, volumeKg: 5400 }])
    }
  })

  it('defaults counts to 0 and series to all-zero when queries return no rows', async () => {
    state.queue = [[], [], [], [], [], [], [], [], []]
    const result = await getAppVitals()
    expect(result.ok && result.data.workoutsCompleted7d).toBe(0)
    expect(result.ok && result.data.recentEvents).toEqual([])
    expect(result.ok && result.data.recentWorkouts).toEqual([])
    if (result.ok) {
      expect(result.data.workoutsPerDay).toHaveLength(14)
      expect(result.data.workoutsPerDay.every((p) => p.value === 0)).toBe(true)
    }
  })

  it("returns 'unavailable' when the database throws", async () => {
    state.shouldThrow = true
    expect(await getAppVitals()).toEqual({ ok: false, reason: 'unavailable' })
  })
})
