import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Chain mock for the cross-user aggregates, same recording style as the ops
 * suite: every db.select()... builder is thenable and resolves the next
 * queued result in call order (the Promise.all array order in
 * getProductAnalytics). `shouldThrow` forces the unavailable path.
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

import { getActiveUsers7d, getProductAnalytics } from './product-analytics'

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

describe('getProductAnalytics', () => {
  it('maps KPIs, 30d series, adoption rows, and the merged activity log', async () => {
    state.queue = [
      [{ workouts7d: 12, workouts30d: 40, activeUsers7d: 4 }], // workout totals
      [{ value: 9 }], // push subscriptions
      [{ active: 3, achieved: 5, created7d: 1, created30d: 2, createdAll: 8 }], // goals
      [{ active: 2, proposed: 1, wger7d: 0, wger30d: 1, wgerAll: 3 }], // programs
      [{ c7: 1, c30: 4, all: 10 }], // photos
      [{ c7: 2, c30: 6, all: 20 }], // measurements
      [{ c7: 3, c30: 9, all: 30 }], // bodyweight logs
      [{ c7: 0, c30: 2, all: 5 }], // templates
      [
        {
          proposed7d: 1,
          proposed30d: 2,
          proposedAll: 4,
          adopted7d: 0,
          adopted30d: 1,
          adoptedAll: 3,
        },
      ], // proposal events
      [{ day: '2026-08-01', value: 2 }], // workouts per day (sparse)
      [{ day: '2026-07-31', value: 1 }], // active users per day (sparse)
      [{ day: '2026-07-20', value: 1 }], // goals achieved per day (sparse)
      [
        {
          actor: 'coach',
          summary: 'Adjusted week 2 volume',
          occurredAt: new Date('2026-08-01T10:00:00Z'),
        },
      ], // program events feed
      [{ name: 'Push Day', completedAt: new Date('2026-08-01T09:00:00Z'), volumeKg: 5400 }], // workouts feed
      [
        {
          kind: 'strength',
          exerciseName: 'Bench Press',
          achievedAt: new Date('2026-08-01T08:00:00Z'),
        },
      ], // goals feed
      [{ pose: 'front', takenAt: new Date('2026-08-01T07:00:00Z') }], // photos feed
      [{ site: 'waist', valueCm: 82.5, measuredAt: new Date('2026-08-01T06:00:00Z') }], // measurements feed
      [{ weightKg: 80.4, weighedAt: new Date('2026-08-01T05:00:00Z') }], // bodyweight feed
    ]

    const result = await getProductAnalytics()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.kpis).toEqual({
        activeUsers7d: 4,
        workouts7d: 12,
        workouts30d: 40,
        avgWorkoutsPerActiveUser7d: 3,
        pushSubscriptions: 9,
        activeGoals: 3,
        achievedGoals: 5,
        photosTotal: 10,
        measurementsTotal: 20,
        programsActive: 2,
        programsProposed: 1,
      })

      // Series come back dense: 30 ascending days, zero-filled around the data.
      expect(result.data.workoutsPerDay).toHaveLength(30)
      expect(result.data.workoutsPerDay[29]).toEqual({ day: '2026-08-01', value: 2 })
      expect(result.data.workoutsPerDay[28]).toEqual({ day: '2026-07-31', value: 0 })
      expect(result.data.activeUsersPerDay).toHaveLength(30)
      expect(result.data.activeUsersPerDay[28]).toEqual({ day: '2026-07-31', value: 1 })
      expect(result.data.goalsAchievedPerDay).toHaveLength(30)
      expect(result.data.goalsAchievedPerDay[17]).toEqual({ day: '2026-07-20', value: 1 })

      expect(result.data.adoption).toEqual([
        { feature: 'Templates saved', count7d: 0, count30d: 2, countAll: 5 },
        { feature: 'wger imports', count7d: 0, count30d: 1, countAll: 3 },
        { feature: 'Coach proposals', count7d: 1, count30d: 2, countAll: 4 },
        { feature: 'Proposals adopted', count7d: 0, count30d: 1, countAll: 3 },
        { feature: 'Goals created', count7d: 1, count30d: 2, countAll: 8 },
        { feature: 'Progress photos', count7d: 1, count30d: 4, countAll: 10 },
        { feature: 'Measurements', count7d: 2, count30d: 6, countAll: 20 },
        { feature: 'Bodyweight logs', count7d: 3, count30d: 9, countAll: 30 },
      ])

      // Merged newest-first across all six sources, lines pre-composed.
      expect(result.data.activity.map((entry) => [entry.type, entry.line])).toEqual([
        ['program', '[coach] Adjusted week 2 volume'],
        ['workout', 'Completed Push Day · 5,400 kg'],
        ['goal', 'Goal achieved: Bench Press'],
        ['photo', 'Progress photo added (front)'],
        ['measurement', 'Measured waist: 82.5 cm'],
        ['bodyweight', 'Bodyweight logged: 80.4 kg'],
      ])
    }
  })

  it('defaults everything to zero/empty when queries return no rows', async () => {
    state.queue = Array.from({ length: 18 }, () => [])
    const result = await getProductAnalytics()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.kpis.workouts7d).toBe(0)
      // No active users → the average must not divide by zero.
      expect(result.data.kpis.avgWorkoutsPerActiveUser7d).toBe(0)
      expect(result.data.workoutsPerDay).toHaveLength(30)
      expect(result.data.workoutsPerDay.every((p) => p.value === 0)).toBe(true)
      expect(result.data.adoption.every((row) => row.countAll === 0)).toBe(true)
      expect(result.data.activity).toEqual([])
    }
  })

  it("returns 'unavailable' when the database throws", async () => {
    state.shouldThrow = true
    expect(await getProductAnalytics()).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('getActiveUsers7d', () => {
  it('returns the distinct active-user count', async () => {
    state.queue = [[{ value: 7 }]]
    expect(await getActiveUsers7d()).toEqual({ ok: true, data: 7 })
  })

  it('defaults to 0 when the query returns no rows', async () => {
    state.queue = [[]]
    expect(await getActiveUsers7d()).toEqual({ ok: true, data: 0 })
  })

  it("returns 'unavailable' when the database throws", async () => {
    state.shouldThrow = true
    expect(await getActiveUsers7d()).toEqual({ ok: false, reason: 'unavailable' })
  })
})
