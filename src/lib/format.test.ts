import { describe, it, expect } from 'vitest'
import { formatWorkoutDate, formatSet, placeholderForSet } from './format'

describe('formatSet', () => {
  it('formats reps and weight together', () => {
    expect(formatSet(5, 100)).toBe('5 × 100 kg')
  })

  it('formats reps only when weight is blank', () => {
    expect(formatSet(5, null)).toBe('5 reps')
  })

  it('formats weight only when reps is blank', () => {
    expect(formatSet(null, 100)).toBe('100 kg')
  })

  it('shows a dash when both are blank', () => {
    expect(formatSet(null, null)).toBe('—')
  })

  it('preserves fractional plate weights', () => {
    expect(formatSet(8, 2.5)).toBe('8 × 2.5 kg')
  })

  it('converts stored kg to lb when unit is lb', () => {
    expect(formatSet(5, 100, 'lb')).toBe('5 × 220.5 lb')
  })

  it('converts a weight-only set to lb', () => {
    expect(formatSet(null, 100, 'lb')).toBe('220.5 lb')
  })

  it('defaults to kg when no unit is given (back-compat)', () => {
    expect(formatSet(5, 100)).toBe('5 × 100 kg')
  })
})

describe('placeholderForSet', () => {
  const last = { sets: [{ reps: 5, weight: 100 }] }

  it('returns the prior set as ghost strings (kg)', () => {
    expect(placeholderForSet(last, 0)).toEqual({ reps: '5', weight: '100' })
  })

  it('converts the weight ghost to the active unit (lb)', () => {
    expect(placeholderForSet(last, 0, 'lb')).toEqual({ reps: '5', weight: '220.5' })
  })

  it('returns {} when there is no history', () => {
    expect(placeholderForSet(null, 0)).toEqual({})
  })

  it('returns {} when there are more sets than history', () => {
    expect(placeholderForSet(last, 1)).toEqual({})
  })

  it('omits a field that was blank last time', () => {
    expect(placeholderForSet({ sets: [{ reps: 5, weight: null }] }, 0)).toEqual({
      reps: '5',
      weight: undefined,
    })
  })
})

describe('formatWorkoutDate', () => {
  it('renders the year (locale-tolerant)', () => {
    // Midday UTC so the date can't roll to the prior day in negative offsets.
    const result = formatWorkoutDate(new Date('2026-06-14T12:00:00Z'))
    expect(result).toContain('2026')
  })
})
