import { describe, it, expect } from 'vitest'
import { startedWithinLastHours } from './recent-window'

const NOW = new Date('2026-07-04T12:00:00.000Z')
const row = (id: string, iso: string) => ({ id, startedAt: new Date(iso) })

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
