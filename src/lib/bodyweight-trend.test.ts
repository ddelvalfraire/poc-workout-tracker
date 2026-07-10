import { describe, it, expect } from 'vitest'
import { bodyweightDeltaKg } from './bodyweight-trend'

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
