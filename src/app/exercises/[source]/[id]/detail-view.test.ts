import { describe, expect, test } from 'vitest'
import {
  buildTrendChartPoints,
  formatStandingTime,
  prWorkoutIds,
  recentE1rmDelta,
  sessionSummary,
  type TrendLike,
} from './detail-view'
import type { SessionSetLike } from '@/lib/session-best-set'

/** Trend fixture builder: sessions a week apart ending at `end`. */
function trendOf(e1rms: number[], end = new Date('2026-08-01T10:00:00Z')): TrendLike[] {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  return e1rms.map((e1rm, i) => ({
    workoutId: `w${i + 1}`,
    performedAt: new Date(end.getTime() - (e1rms.length - 1 - i) * WEEK_MS),
    e1rm,
  }))
}

const NOW = new Date('2026-08-03T10:00:00Z')

describe('recentE1rmDelta', () => {
  test('returns null for a single session', () => {
    expect(recentE1rmDelta(trendOf([100]), NOW)).toBeNull()
  })

  test('short history falls back to vs-first', () => {
    // 4 sessions < recent(3) + prior(2) → best (110) vs first (100).
    const delta = recentE1rmDelta(trendOf([100, 105, 102, 110]), NOW)
    expect(delta).toEqual({ gainKg: 10, basis: 'first', withinMonth: false })
  })

  test('short flat history returns null', () => {
    expect(recentE1rmDelta(trendOf([100, 100]), NOW)).toBeNull()
  })

  test('long history compares best-of-last-3 vs best-of-prior', () => {
    // prior [100, 104, 101], recent [102, 107, 105] → 107 - 104 = 3.
    const delta = recentE1rmDelta(trendOf([100, 104, 101, 102, 107, 105]), NOW)
    expect(delta).toEqual({ gainKg: 3, basis: 'recent', withinMonth: true })
  })

  test('windows further back than a month drop the this-month phrasing', () => {
    // The recent window ends long before `now` — it no longer sits inside
    // the last month, so the caption must not claim "this month".
    const old = trendOf([100, 104, 101, 102, 107, 105], new Date('2026-05-01T10:00:00Z'))
    const delta = recentE1rmDelta(old, NOW)
    expect(delta).toEqual({ gainKg: 3, basis: 'recent', withinMonth: false })
  })

  test('regressed recent window returns null, not a negative number', () => {
    // prior best 110, recent best 105 → silence over a scary number.
    expect(recentE1rmDelta(trendOf([100, 110, 108, 101, 105, 103]), NOW)).toBeNull()
  })
})

describe('prWorkoutIds', () => {
  test('marks running-max advances including the first session', () => {
    const ids = prWorkoutIds(trendOf([100, 105, 103, 110]))
    expect([...ids]).toEqual(['w1', 'w2', 'w4'])
  })

  test('a tie is a repeat, not a record', () => {
    const ids = prWorkoutIds(trendOf([100, 100]))
    expect([...ids]).toEqual(['w1'])
  })

  test('empty trend marks nothing', () => {
    expect(prWorkoutIds([]).size).toBe(0)
  })
})

describe('buildTrendChartPoints', () => {
  test('maps to epoch x, display-unit value, and pr flags', () => {
    const trend = trendOf([100, 105])
    const points = buildTrendChartPoints(trend, 'kg', new Set(['w2']))
    expect(points).toEqual([
      {
        t: trend[0].performedAt.getTime(),
        label: 'Jul 25, 2026',
        value: 100,
      },
      {
        t: trend[1].performedAt.getTime(),
        label: 'Aug 1, 2026',
        value: 105,
        pr: true,
      },
    ])
  })

  test('converts values to lb for lb users', () => {
    const [point] = buildTrendChartPoints(trendOf([100]), 'lb', new Set())
    expect(point.value).toBe(220.5)
  })
})

describe('formatStandingTime', () => {
  const now = new Date('2026-08-03T10:00:00Z')
  const daysBefore = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  test('fresh records stay quiet', () => {
    expect(formatStandingTime(daysBefore(13), now)).toBeNull()
  })

  test('weeks between two weeks and two months', () => {
    expect(formatStandingTime(daysBefore(14), now)).toBe('held 2 weeks')
    expect(formatStandingTime(daysBefore(45), now)).toBe('held 6 weeks')
  })

  test('months up to two years', () => {
    expect(formatStandingTime(daysBefore(61), now)).toBe('held 2 months')
    expect(formatStandingTime(daysBefore(244), now)).toBe('held 8 months')
  })

  test('years beyond that', () => {
    expect(formatStandingTime(daysBefore(731), now)).toBe('held 2 years')
    expect(formatStandingTime(daysBefore(1500), now)).toBe('held 4 years')
  })
})

describe('sessionSummary', () => {
  const set = (overrides: Partial<SessionSetLike>): SessionSetLike => ({
    reps: 5,
    weight: 100,
    completed: true,
    metricMode: 'reps_weight',
    setType: 'working',
    ...overrides,
  })

  test('picks the best set and counts every displayed set', () => {
    const sets = [
      set({ weight: 100 }),
      set({ weight: 110 }),
      set({ weight: 105, completed: false }),
    ]
    const summary = sessionSummary(sets, 'weight_reps')
    expect(summary.setCount).toBe(3)
    expect(summary.best?.index).toBe(1)
    expect(summary.best?.e1rmKg).not.toBeNull()
  })

  test('nothing scorable → null best, honest count', () => {
    const sets = [set({ setType: 'warmup' }), set({ completed: false })]
    const summary = sessionSummary(sets, 'weight_reps')
    expect(summary).toEqual({ best: null, setCount: 2 })
  })

  test('bodyweight types without a bodyweight fall back to rep comparison', () => {
    const sets = [set({ reps: 8, weight: null }), set({ reps: 12, weight: null })]
    const summary = sessionSummary(sets, 'bodyweight_reps')
    expect(summary.best?.index).toBe(1)
    expect(summary.best?.e1rmKg).toBeNull()
  })
})
