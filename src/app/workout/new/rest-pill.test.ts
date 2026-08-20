import { describe, expect, it } from 'vitest'
import {
  REST_CLOSING_WINDOW_SEC,
  isRestClosing,
  restProgressFraction,
  restReadout,
} from './rest-pill'

describe('isRestClosing', () => {
  it('flags the last-10s window of a countdown', () => {
    expect(isRestClosing(REST_CLOSING_WINDOW_SEC, 90)).toBe(true)
    expect(isRestClosing(1, 90)).toBe(true)
  })

  it('stays quiet above the window', () => {
    expect(isRestClosing(REST_CLOSING_WINDOW_SEC + 1, 90)).toBe(false)
  })

  it('hands off to the overage/warning state at zero and below', () => {
    expect(isRestClosing(0, 90)).toBe(false)
    expect(isRestClosing(-5, 90)).toBe(false)
  })

  it('never closes in count-up mode or against a zero target', () => {
    expect(isRestClosing(5, null)).toBe(false)
    expect(isRestClosing(5, 0)).toBe(false)
  })
})

describe('restProgressFraction', () => {
  it('returns the remaining fraction of the target', () => {
    // Arrange + Act
    const fraction = restProgressFraction(45, 90)

    // Assert
    expect(fraction).toBe(0.5)
  })

  it('clamps overage to 0 (fill fully drained, never negative)', () => {
    expect(restProgressFraction(-30, 90)).toBe(0)
  })

  it('clamps a +15-extended remainder past the target to 1 (never overflows the pill)', () => {
    expect(restProgressFraction(105, 90)).toBe(1)
  })

  it('returns null with no target — count-up mode has no fill', () => {
    expect(restProgressFraction(45, null)).toBeNull()
  })

  it('returns null for a zero target — nothing to deplete', () => {
    expect(restProgressFraction(0, 0)).toBeNull()
  })
})

describe('restReadout', () => {
  it('counts up with no target, never flagging over', () => {
    // Arrange + Act
    const readout = restReadout(75_000, null)

    // Assert
    expect(readout).toEqual({
      text: '1:15',
      label: { key: 'countUp', values: { time: '1:15' } },
      isOver: false,
    })
  })

  it('counts down the remaining span while under the target', () => {
    const readout = restReadout(30_000, 90)

    expect(readout).toEqual({
      text: '1:00',
      label: { key: 'remaining', values: { time: '1:00', target: 90 } },
      isOver: false,
    })
  })

  it('flips to +overage in over mode once the target is spent', () => {
    const readout = restReadout(100_000, 90)

    expect(readout).toEqual({
      text: '+0:10',
      label: { key: 'over', values: { time: '0:10', target: 90 } },
      isOver: true,
    })
  })

  it('hides for a negative span (clock skew) — the pill must not show garbage', () => {
    expect(restReadout(-1_000, 90)).toBeNull()
  })

  it('goes quiet past the plausibility ceiling instead of counting an absurd overage', () => {
    // Arrange — a session left open overnight: 8 h of "overage"
    const eightHoursMs = 8 * 3_600_000

    // Act + Assert — formatElapsed's 6 h ceiling nulls the text, hiding the readout
    expect(restReadout(eightHoursMs, 90)).toBeNull()
    expect(restReadout(eightHoursMs, null)).toBeNull()
  })
})
