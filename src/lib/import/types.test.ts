import { describe, it, expect } from 'vitest'
import { parseWallTime } from './types'

describe('parseWallTime', () => {
  it('parses Strong-style "YYYY-MM-DD HH:MM:SS" as UTC wall time', () => {
    expect(parseWallTime('2024-01-15 17:32:11')?.toISOString()).toBe('2024-01-15T17:32:11.000Z')
  })

  it('parses without seconds and with a T separator', () => {
    expect(parseWallTime('2024-01-15T17:32')?.toISOString()).toBe('2024-01-15T17:32:00.000Z')
  })

  it('parses Hevy-style "15 Jan 2024, 17:32"', () => {
    expect(parseWallTime('15 Jan 2024, 17:32')?.toISOString()).toBe('2024-01-15T17:32:00.000Z')
  })

  it('parses a single-digit day and full month name', () => {
    expect(parseWallTime('2 January 2024, 08:05')?.toISOString()).toBe('2024-01-02T08:05:00.000Z')
  })

  it('is deterministic regardless of server timezone (stores digits as UTC)', () => {
    // The digits 17:32 must survive verbatim — no offset shift.
    const parsed = parseWallTime('2024-06-01 17:32:00')
    expect(parsed?.getUTCHours()).toBe(17)
    expect(parsed?.getUTCMinutes()).toBe(32)
  })

  it('rejects rollover dates instead of silently shifting them', () => {
    expect(parseWallTime('2024-02-30 10:00:00')).toBeNull()
    expect(parseWallTime('2024-13-01 10:00:00')).toBeNull()
  })

  it('rejects out-of-range clock parts', () => {
    expect(parseWallTime('2024-01-15 24:00:00')).toBeNull()
    expect(parseWallTime('2024-01-15 10:61:00')).toBeNull()
  })

  it('rejects garbage and unknown month names', () => {
    expect(parseWallTime('yesterday')).toBeNull()
    expect(parseWallTime('15 Foo 2024, 17:32')).toBeNull()
    expect(parseWallTime('')).toBeNull()
  })
})
