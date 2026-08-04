import { describe, it, expect } from 'vitest'
import { bodyweightDeltaKg, seriesDeltaAt, trendWeightSeries } from './bodyweight-trend'

const NOW = new Date('2026-07-10T00:00:00Z')

/** A log point `daysAgo` days before NOW (freshest-first fixtures below). */
function point(daysAgo: number, weightKg: number) {
  return { weighedAt: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000), weightKg }
}

describe('bodyweightDeltaKg', () => {
  it('returns null with fewer than 2 entries', () => {
    expect(bodyweightDeltaKg([], 30, NOW)).toBe(null)
    expect(bodyweightDeltaKg([point(0, 82)], 30, NOW)).toBe(null)
  })

  it('returns current minus the freshest entry at or before the cutoff', () => {
    // Arrange — freshest first: today 84.1, 10d ago 83.0, 35d ago 82.5
    const logs = [point(0, 84.1), point(10, 83.0), point(35, 82.5)]

    // Act / Assert — baseline is the 35d entry (freshest ≤ 30d cutoff)
    expect(bodyweightDeltaKg(logs, 30, NOW)).toBe(1.6)
  })

  it('skips newer-than-cutoff entries to find the baseline', () => {
    // 40d entry is baseline even though a 20d entry sits between
    const logs = [point(0, 80.0), point(20, 81.0), point(40, 82.0)]

    expect(bodyweightDeltaKg(logs, 30, NOW)).toBe(-2)
  })

  it('returns null when no entry is old enough to anchor the window', () => {
    // All logs within the last week — a "30d" delta would be a lie
    const logs = [point(0, 84.1), point(3, 83.9), point(6, 83.5)]

    expect(bodyweightDeltaKg(logs, 30, NOW)).toBe(null)
  })

  it('returns null when the freshest entry is itself past the cutoff (stale logger)', () => {
    // Current weigh-in is 45 days old — a "/30d" delta label would mislead
    const logs = [point(45, 84.1), point(60, 83.0)]

    expect(bodyweightDeltaKg(logs, 30, NOW)).toBe(null)
  })

  it('rounds the delta to 2 decimals (column precision)', () => {
    const logs = [point(0, 84.13), point(35, 82.51)]

    expect(bodyweightDeltaKg(logs, 30, NOW)).toBe(1.62)
  })
})

describe('seriesDeltaAt (the generic core — measurements use it directly)', () => {
  const p = (daysAgo: number, value: number) => ({
    atMs: NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000,
    value,
  })

  it('mirrors the bodyweight semantics on plain display values', () => {
    // 90d measurement window: latest 33.5, baseline (95d ago) 35.0
    expect(seriesDeltaAt([p(0, 33.5), p(30, 34.2), p(95, 35.0)], 90, NOW.getTime())).toBe(-1.5)
  })

  it('is null when the window is uncovered or the series is thin', () => {
    expect(seriesDeltaAt([], 90, NOW.getTime())).toBe(null)
    expect(seriesDeltaAt([p(0, 33.5)], 90, NOW.getTime())).toBe(null)
    expect(seriesDeltaAt([p(0, 33.5), p(30, 34.0)], 90, NOW.getTime())).toBe(null)
  })

  it('is null when even the freshest point predates the cutoff (stale series)', () => {
    expect(seriesDeltaAt([p(120, 33.5), p(150, 34.0)], 90, NOW.getTime())).toBe(null)
  })
})

describe('trendWeightSeries (7-day time-decayed EMA)', () => {
  it('is empty for no logs and seeds from the first reading', () => {
    expect(trendWeightSeries([])).toEqual([])
    const single = trendWeightSeries([point(0, 82)])
    expect(single).toHaveLength(1)
    expect(single[0].weightKg).toBe(82)
  })

  it('keeps input/output freshest-first with matching instants', () => {
    const logs = [point(0, 84), point(7, 83), point(14, 82)]
    const trend = trendWeightSeries(logs)
    expect(trend.map((t) => t.weighedAt)).toEqual(logs.map((l) => l.weighedAt))
  })

  it('smooths toward new readings by 1 − e^(−Δdays/τ)', () => {
    // Oldest 80, then 7 days later 90: w = 1 − e^(−1) ≈ 0.6321
    const logs = [point(0, 90), point(7, 80)]
    const trend = trendWeightSeries(logs)
    expect(trend[1].weightKg).toBe(80) // seed
    expect(trend[0].weightKg).toBeCloseTo(80 + (1 - Math.exp(-1)) * 10, 6)
  })

  it('a same-instant duplicate reading cannot move the trend (Δt = 0)', () => {
    const at = point(0, 84).weighedAt
    const logs = [
      { weighedAt: at, weightKg: 99 }, // spurious duplicate at the same instant
      { weighedAt: at, weightKg: 84 },
    ]
    const trend = trendWeightSeries(logs)
    expect(trend[0].weightKg).toBe(84)
  })

  it('tracks a steady loss without overshooting the raw readings', () => {
    // Daily 0.1 kg loss for 30 days: the trend lags the raw but moves down.
    const logs = Array.from({ length: 30 }, (_, i) => point(29 - i, 85 - 0.1 * i)).reverse()
    const trend = trendWeightSeries(logs)
    const latestRaw = logs[0].weightKg
    expect(trend[0].weightKg).toBeGreaterThan(latestRaw) // lags behind the loss
    expect(trend[0].weightKg).toBeLessThan(85) // but clearly moved down
  })
})
