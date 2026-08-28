import { describe, it, expect } from 'vitest'
import { formatPace, secPerMile } from './pace'

describe('formatPace', () => {
  it('formats as m:ss with padded seconds', () => {
    expect(formatPace(292)).toBe('4:52')
    expect(formatPace(305)).toBe('5:05')
  })

  it('rounds before splitting, so seconds never reach 60', () => {
    // 299.6 rounds to 300 -> 5:00. Splitting first would give 4:60.
    expect(formatPace(299.6)).toBe('5:00')
  })

  it('folds hours into minutes rather than reading like a clock time', () => {
    expect(formatPace(4800)).toBe('80:00')
  })

  it('handles a sub-minute pace', () => {
    expect(formatPace(45)).toBe('0:45')
  })
})

describe('secPerMile', () => {
  it('grows the pace number, because a mile is longer than a kilometre', () => {
    // 4:52/km (292s) is 7:50/mi — not 3:01. Showing a km pace under a mile
    // label is a lie that looks plausible, since both land in the same range.
    expect(formatPace(secPerMile(292))).toBe('7:50')
  })

  it('round-trips a whole-minute pace', () => {
    expect(Math.round(secPerMile(300))).toBe(483)
  })
})
