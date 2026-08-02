import { describe, it, expect } from 'vitest'
import { ACTIVITY_TYPES, filterActivity, mergeActivity, type ActivityItem } from './activity'

const item = (type: ActivityItem['type'], iso: string, line = type): ActivityItem => ({
  type,
  line,
  at: new Date(iso),
})

describe('mergeActivity', () => {
  it('merges sources newest-first across types', () => {
    const merged = mergeActivity([
      [item('workout', '2026-08-01T10:00:00Z'), item('workout', '2026-07-30T10:00:00Z')],
      [item('program', '2026-08-01T11:00:00Z')],
      [item('goal', '2026-07-31T10:00:00Z')],
    ])
    expect(merged.map((entry) => entry.type)).toEqual(['program', 'workout', 'goal', 'workout'])
  })

  it('caps the merged log at the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      item('workout', `2026-07-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`),
    )
    expect(mergeActivity([many, many], 50)).toHaveLength(50)
    expect(mergeActivity([many, many], 10)).toHaveLength(10)
  })

  it('does not mutate its inputs', () => {
    const source = [item('photo', '2026-07-01T00:00:00Z'), item('photo', '2026-07-02T00:00:00Z')]
    const snapshot = [...source]
    mergeActivity([source])
    expect(source).toEqual(snapshot)
  })
})

describe('filterActivity', () => {
  const items = [
    item('workout', '2026-08-01T10:00:00Z'),
    item('program', '2026-08-01T09:00:00Z'),
    item('bodyweight', '2026-08-01T08:00:00Z'),
  ]

  it('returns everything when no chip is selected', () => {
    expect(filterActivity(items, new Set())).toEqual(items)
  })

  it('keeps only the selected types, preserving order', () => {
    const filtered = filterActivity(items, new Set(['workout', 'bodyweight'] as const))
    expect(filtered.map((entry) => entry.type)).toEqual(['workout', 'bodyweight'])
  })

  it('covers every declared type label', () => {
    expect([...ACTIVITY_TYPES].sort()).toEqual(
      ['bodyweight', 'goal', 'measurement', 'photo', 'program', 'workout'].sort(),
    )
  })
})
