import { describe, it, expect } from 'vitest'

import {
  isRestClosing,
  restReadout,
  restProgressFraction,
  REST_CLOSING_WINDOW_SEC,
} from './rest-pill'

/**
 * ADVERSARIAL (#217): boundary attacks on the last-10s volt window and the
 * overage handoff. Spec claims under attack:
 * - digits flip to volt for the last REST_CLOSING_WINDOW_SEC (10) seconds
 * - overage owns <= 0 (warning wins there, closing must yield)
 * - a target CHANGE mid-countdown (+15 at 9s remaining) must retract the volt
 * - the pill must never blank out across the 1s..0s..overage handoff
 */

describe('isRestClosing window boundaries (#217 attack)', () => {
  it('exactly 10s remaining IS closing (window is inclusive at the top)', () => {
    expect(isRestClosing(REST_CLOSING_WINDOW_SEC, 60)).toBe(true)
  })

  it('11s remaining is NOT closing', () => {
    expect(isRestClosing(REST_CLOSING_WINDOW_SEC + 1, 60)).toBe(false)
  })

  it('1s remaining is closing; exactly 0 is NOT (overage owns <= 0)', () => {
    expect(isRestClosing(1, 60)).toBe(true)
    expect(isRestClosing(0, 60)).toBe(false)
    expect(isRestClosing(-1, 60)).toBe(false)
  })

  it('count-up mode (null target) and degenerate targets have no window', () => {
    expect(isRestClosing(5, null)).toBe(false)
    expect(isRestClosing(5, 0)).toBe(false)
    expect(isRestClosing(5, -30)).toBe(false)
  })

  it('a target shorter than the window is closing from second one (documented consequence)', () => {
    // An 8s target spends its ENTIRE countdown inside the "last-10s" window —
    // the digits are volt the whole time. Not a failure of the pure fn, but
    // the "wrap it up" semantics degrade for very short targets.
    expect(isRestClosing(8, 8)).toBe(true)
  })
})

describe('volt retraction on target change mid-countdown (#217 attack)', () => {
  it('+15 pressed at 9s remaining pushes remaining to 24s — volt must retract', () => {
    // Before: 9s left of a 60s target — closing (volt digits).
    expect(isRestClosing(9, 60)).toBe(true)
    // The logger adds +15 to the CURRENT period's offset; the pill recomputes
    // remaining (24) against the adjusted target (75) on the next tick.
    expect(isRestClosing(24, 75)).toBe(false)
    // And even against an unchanged target value, 24s remaining is not closing.
    expect(isRestClosing(24, 60)).toBe(false)
  })

  it('-15 pressed at 20s remaining drops remaining to 5s — volt must engage', () => {
    expect(isRestClosing(20, 60)).toBe(false)
    expect(isRestClosing(5, 45)).toBe(true)
  })
})

describe('overage handoff continuity (#217 attack)', () => {
  it('readout never blanks across 1s → 0s → overage', () => {
    const target = 60
    // 1s remaining (restMs = 59s)
    const atOne = restReadout(59_000, target)
    expect(atOne).not.toBeNull()
    expect(atOne!.isOver).toBe(false)
    // exactly 0 remaining (restMs = 60s): must be the overage shape, not null
    const atZero = restReadout(60_000, target)
    expect(atZero).not.toBeNull()
    expect(atZero!.isOver).toBe(true)
    expect(atZero!.text).toBe('+0:00')
    // 1s over
    const over = restReadout(61_000, target)
    expect(over).not.toBeNull()
    expect(over!.text).toBe('+0:01')
  })

  it('fill fraction clamps at both edges (no negative scale on overage, no >1 after +15)', () => {
    expect(restProgressFraction(-5, 60)).toBe(0)
    expect(restProgressFraction(0, 60)).toBe(0)
    // +15 past the original target: remaining > target must clamp to 1
    expect(restProgressFraction(70, 60)).toBe(1)
    expect(restProgressFraction(0, null)).toBeNull()
  })

  it('closing=false exactly when overage=true at the 0 boundary (never both)', () => {
    const target = 60
    for (const remainingSec of [2, 1, 0, -1, -2]) {
      const readout = restReadout((target - remainingSec) * 1_000, target)!
      const closing = isRestClosing(remainingSec, target)
      expect(readout).not.toBeNull()
      // warning and volt-closing may never claim the digits at once
      expect(closing && readout.isOver).toBe(false)
    }
  })
})
