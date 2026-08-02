import { describe, it, expect } from 'vitest'
import { timeAgo, formatDurationMs, shortDayLabel } from './time'

const NOW = Date.parse('2026-08-01T12:00:00Z')

describe('timeAgo', () => {
  it('formats seconds, minutes, hours, and days', () => {
    expect(timeAgo('2026-08-01T11:59:30Z', NOW)).toBe('30s ago')
    expect(timeAgo('2026-08-01T11:45:00Z', NOW)).toBe('15m ago')
    expect(timeAgo('2026-08-01T09:00:00Z', NOW)).toBe('3h ago')
    expect(timeAgo('2026-07-30T12:00:00Z', NOW)).toBe('2d ago')
  })

  it('accepts Date instances', () => {
    expect(timeAgo(new Date('2026-08-01T11:00:00Z'), NOW)).toBe('1h ago')
  })

  it('clamps future timestamps to zero instead of going negative', () => {
    expect(timeAgo('2026-08-01T12:05:00Z', NOW)).toBe('0s ago')
  })

  it('returns empty string for null and unparseable input', () => {
    expect(timeAgo(null, NOW)).toBe('')
    expect(timeAgo('not-a-date', NOW)).toBe('')
  })
})

describe('formatDurationMs', () => {
  it('formats sub-minute and minute+second durations', () => {
    expect(formatDurationMs(42_000)).toBe('42s')
    expect(formatDurationMs(192_000)).toBe('3m 12s')
  })

  it('returns empty string for null, negative, and non-finite input', () => {
    expect(formatDurationMs(null)).toBe('')
    expect(formatDurationMs(-1)).toBe('')
    expect(formatDurationMs(Number.NaN)).toBe('')
  })
})

describe('shortDayLabel', () => {
  it('formats a UTC day key as a short tick label', () => {
    expect(shortDayLabel('2026-07-19')).toBe('Jul 19')
    expect(shortDayLabel('2026-08-01')).toBe('Aug 1')
  })

  it('returns empty string for garbage', () => {
    expect(shortDayLabel('nope')).toBe('')
  })
})
