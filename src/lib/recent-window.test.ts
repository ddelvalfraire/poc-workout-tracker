import { describe, it, expect } from 'vitest'
import { startedWithinLastHours, completedWithinLastHours } from './recent-window'

const NOW = new Date('2026-07-04T12:00:00.000Z')
const row = (id: string, iso: string) => ({ id, startedAt: new Date(iso) })
const done = (id: string, iso: string | null) => ({
  id,
  completedAt: iso === null ? null : new Date(iso),
})

describe('startedWithinLastHours', () => {
  it('keeps rows inside the window and drops older ones', () => {
    const rows = [
      row('now', '2026-07-04T11:00:00.000Z'),
      row('yesterday', '2026-07-03T13:00:00.000Z'),
      row('too-old', '2026-07-02T11:59:00.000Z'),
    ]

    const kept = startedWithinLastHours(rows, 48, NOW)

    expect(kept.map((r) => r.id)).toEqual(['now', 'yesterday'])
  })

  it('keeps future-dated rows (clock skew must not hide a just-logged session)', () => {
    const rows = [row('skewed', '2026-07-04T12:00:30.000Z')]

    expect(startedWithinLastHours(rows, 48, NOW)).toHaveLength(1)
  })

  it('returns an empty array for no matches without mutating the input', () => {
    const rows = [row('old', '2026-07-01T00:00:00.000Z')]

    expect(startedWithinLastHours(rows, 48, NOW)).toEqual([])
    expect(rows).toHaveLength(1)
  })
})

describe('completedWithinLastHours', () => {
  it('is true when any workout completed inside the window', () => {
    const rows = [done('older', '2026-07-02T12:00:00.000Z'), done('recent', '2026-07-04T08:00:00.000Z')]

    expect(completedWithinLastHours(rows, 12, NOW)).toBe(true)
  })

  it('ignores in-progress workouts (null completedAt)', () => {
    expect(completedWithinLastHours([done('live', null)], 12, NOW)).toBe(false)
  })

  it('is false once the completion falls outside the window', () => {
    // Arrange — exactly 12h ago is IN; one second past is out
    const boundary = [done('exactly', '2026-07-04T00:00:00.000Z')]
    const past = [done('past', '2026-07-03T23:59:59.000Z')]

    expect(completedWithinLastHours(boundary, 12, NOW)).toBe(true)
    expect(completedWithinLastHours(past, 12, NOW)).toBe(false)
  })

  it('keeps future-dated completions (clock skew must not resurrect the hero)', () => {
    expect(completedWithinLastHours([done('skewed', '2026-07-04T12:00:30.000Z')], 12, NOW)).toBe(
      true,
    )
  })
})
