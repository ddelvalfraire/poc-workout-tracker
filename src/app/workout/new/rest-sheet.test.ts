import { describe, test, expect } from 'vitest'
import { parseCustomRest } from './rest-sheet'

describe('parseCustomRest', () => {
  test('parses whole-second values, trimming whitespace', () => {
    expect(parseCustomRest('90')).toBe(90)
    expect(parseCustomRest('  120 ')).toBe(120)
  })

  test('accepts the 0 and 3600 boundary values', () => {
    // 0 is a real target (explicit "no rest"), not an unset marker.
    expect(parseCustomRest('0')).toBe(0)
    expect(parseCustomRest('3600')).toBe(3600)
  })

  test('rejects out-of-range, fractional, negative, and non-numeric text', () => {
    expect(parseCustomRest('3601')).toBeNull()
    expect(parseCustomRest('90.5')).toBeNull()
    expect(parseCustomRest('-30')).toBeNull()
    expect(parseCustomRest('abc')).toBeNull()
    expect(parseCustomRest('')).toBeNull()
    expect(parseCustomRest('1:30')).toBeNull()
  })
})
