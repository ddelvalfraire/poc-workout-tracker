import { describe, it, expect } from 'vitest'
import type { WorkoutSummary } from '@/db/workouts'
import { historyStatusLine, monthBuckets, rowEmphasisPct } from './history-view'

function summary(startedAt: string, over: Partial<WorkoutSummary> = {}): WorkoutSummary {
  return {
    id: `w-${startedAt}`,
    name: 'Workout',
    startedAt: new Date(startedAt),
    completedAt: new Date(startedAt),
    exerciseCount: 1,
    setCount: 3,
    completedSetCount: 3,
    volumeKg: 1000,
    ...over,
  }
}

const now = new Date('2026-08-03T12:00:00Z')

describe('monthBuckets', () => {
  it('groups a newest-first list into months with rollups, order preserved', () => {
    const workouts = [
      summary('2026-08-02T10:00:00Z', { volumeKg: 500 }),
      summary('2026-08-01T10:00:00Z', { volumeKg: 700 }),
      summary('2026-07-20T10:00:00Z'),
    ]

    const buckets = monthBuckets(workouts, now)

    expect(buckets.map((b) => b.key)).toEqual(['2026-08', '2026-07'])
    expect(buckets[0]).toMatchObject({ label: 'August', sessions: 2, volumeKg: 1200 })
    expect(buckets[0].workouts.map((w) => w.id)).toEqual([
      'w-2026-08-02T10:00:00Z',
      'w-2026-08-01T10:00:00Z',
    ])
  })

  it('appends the year only for months outside the current year', () => {
    const buckets = monthBuckets([summary('2025-12-30T10:00:00Z')], now)

    expect(buckets[0].label).toBe('December 2025')
  })

  it('does not merge the same month across different years', () => {
    const buckets = monthBuckets(
      [summary('2026-08-01T10:00:00Z'), summary('2025-08-01T10:00:00Z')],
      now,
    )

    expect(buckets.map((b) => b.key)).toEqual(['2026-08', '2025-08'])
  })

  it('is empty for an empty list and never mutates input', () => {
    expect(monthBuckets([], now)).toEqual([])
    const workouts = [summary('2026-08-01T10:00:00Z')]
    const before = workouts.map((w) => ({ ...w }))
    monthBuckets(workouts, now)
    expect(workouts).toEqual(before)
  })
})

describe('historyStatusLine', () => {
  it('counts the trailing 30 days, singular handled', () => {
    expect(historyStatusLine([summary('2026-07-20T10:00:00Z')], now)).toBe(
      '1 session in the last 30 days.',
    )
  })

  it('is null when the trailing 30 days are empty', () => {
    expect(historyStatusLine([summary('2026-05-01T10:00:00Z')], now)).toBeNull()
    expect(historyStatusLine([], now)).toBeNull()
  })

  it('claims the record month only when strictly ahead of every other month', () => {
    const twoInJuly = [summary('2026-07-10T10:00:00Z'), summary('2026-07-12T10:00:00Z')]
    const threeInAugust = [
      summary('2026-08-01T10:00:00Z'),
      summary('2026-08-02T10:00:00Z'),
      summary('2026-08-03T09:00:00Z'),
    ]

    expect(historyStatusLine([...threeInAugust, ...twoInJuly], now)).toBe(
      '5 sessions in the last 30 days — your most consistent month yet.',
    )
    // A tie is not a record.
    expect(historyStatusLine([...threeInAugust.slice(0, 2), ...twoInJuly], now)).toBe(
      '4 sessions in the last 30 days.',
    )
  })

  it('never claims a record with no other month to beat', () => {
    expect(
      historyStatusLine([summary('2026-08-01T10:00:00Z'), summary('2026-08-02T10:00:00Z')], now),
    ).toBe('2 sessions in the last 30 days.')
  })
})

describe('rowEmphasisPct', () => {
  it('normalizes to the list max as a whole percent', () => {
    expect(rowEmphasisPct(500, 1000)).toBe(50)
    expect(rowEmphasisPct(1000, 1000)).toBe(100)
  })

  it('is 0 when the max is 0 (never NaN or Infinity)', () => {
    expect(rowEmphasisPct(0, 0)).toBe(0)
  })
})
