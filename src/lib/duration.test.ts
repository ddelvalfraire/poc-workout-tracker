import { describe, expect, test } from 'vitest'
import {
  MAX_DURATION_SEC,
  formatDistanceInput,
  formatDurationInput,
  parseDistanceInput,
  parseDurationInput,
} from './duration'

describe('formatDurationInput', () => {
  test('renders mm:ss under an hour', () => {
    expect(formatDurationInput(750)).toBe('12:30')
    expect(formatDurationInput(45)).toBe('0:45')
    expect(formatDurationInput(90)).toBe('1:30')
  })

  test('renders h:mm:ss at an hour and beyond', () => {
    expect(formatDurationInput(3905)).toBe('1:05:05')
    expect(formatDurationInput(3600)).toBe('1:00:00')
  })

  test('floors fractions and clamps negatives to zero', () => {
    expect(formatDurationInput(90.9)).toBe('1:30')
    expect(formatDurationInput(-5)).toBe('0:00')
  })
})

describe('parseDurationInput', () => {
  test('parses mm:ss and h:mm:ss', () => {
    expect(parseDurationInput('12:30')).toBe(750)
    expect(parseDurationInput('0:45')).toBe(45)
    expect(parseDurationInput('1:05:05')).toBe(3905)
  })

  test('bare numbers read as minutes', () => {
    expect(parseDurationInput('30')).toBe(1800)
    expect(parseDurationInput('1.5')).toBe(90)
  })

  test('round-trips its own format', () => {
    for (const sec of [45, 90, 750, 3600, 3905]) {
      expect(parseDurationInput(formatDurationInput(sec))).toBe(sec)
    }
  })

  test('rejects blank, junk, zero, overflow segments, and past-cap values', () => {
    expect(parseDurationInput('')).toBeNull()
    expect(parseDurationInput('  ')).toBeNull()
    expect(parseDurationInput('abc')).toBeNull()
    expect(parseDurationInput('-5')).toBeNull()
    expect(parseDurationInput('0')).toBeNull()
    expect(parseDurationInput('0:00')).toBeNull()
    expect(parseDurationInput('1:75')).toBeNull() // 75 s is a typo, not 2:15
    expect(parseDurationInput('1:75:00')).toBeNull()
    expect(parseDurationInput(String(MAX_DURATION_SEC / 60 + 1))).toBeNull()
  })
})

describe('distance input codec (km entry, meters stored)', () => {
  test('formats meters as trimmed km', () => {
    expect(formatDistanceInput(2500)).toBe('2.5')
    expect(formatDistanceInput(400)).toBe('0.4')
    expect(formatDistanceInput(5000)).toBe('5')
  })

  test('parses km to meters', () => {
    expect(parseDistanceInput('5')).toBe(5000)
    expect(parseDistanceInput('0.4')).toBe(400)
    expect(parseDistanceInput('2.5')).toBe(2500)
  })

  test('round-trips format ↔ parse', () => {
    for (const m of [400, 2500, 5000, 10_000]) {
      expect(parseDistanceInput(formatDistanceInput(m))).toBe(m)
    }
  })

  test('rejects blank, junk, zero, negatives, and past-column-cap values', () => {
    expect(parseDistanceInput('')).toBeNull()
    expect(parseDistanceInput('abc')).toBeNull()
    expect(parseDistanceInput('-1')).toBeNull()
    expect(parseDistanceInput('0')).toBeNull()
    expect(parseDistanceInput('10001')).toBeNull() // > 9,999,999.99 m in km terms
  })
})
