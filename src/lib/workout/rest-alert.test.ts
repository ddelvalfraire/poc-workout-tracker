import { describe, expect, it } from 'vitest'
import {
  adjustedRestTarget,
  createRestEdgeDetector,
  REST_ADJUST_STEP_SEC,
  REST_OVER_VIBRATION,
} from './rest-alert'

describe('createRestEdgeDetector', () => {
  it('fires exactly once when the countdown crosses zero', () => {
    // Arrange
    const detector = createRestEdgeDetector()

    // Act + Assert — ticking down: silent while positive, one fire at zero
    expect(detector.observe(1, 3)).toBe(false)
    expect(detector.observe(1, 2)).toBe(false)
    expect(detector.observe(1, 1)).toBe(false)
    expect(detector.observe(1, 0)).toBe(true)
    expect(detector.observe(1, -1)).toBe(false)
    expect(detector.observe(1, -2)).toBe(false)
  })

  it('does not fire when first observed already at or past zero (re-mount mid-overage)', () => {
    // Arrange — a fresh detector, as after a component re-mount
    const detector = createRestEdgeDetector()

    // Act + Assert — never saw this period positive, so no fire
    expect(detector.observe(7, 0)).toBe(false)
    expect(detector.observe(7, -5)).toBe(false)
  })

  it('stays silent on repeated observations of the same crossing (StrictMode double run)', () => {
    const detector = createRestEdgeDetector()
    detector.observe(1, 5)
    expect(detector.observe(1, 0)).toBe(true)
    // The same effect body re-runs with identical values.
    expect(detector.observe(1, 0)).toBe(false)
  })

  it('re-arms for a NEW rest period', () => {
    const detector = createRestEdgeDetector()
    detector.observe(1, 1)
    expect(detector.observe(1, 0)).toBe(true)
    // Next check-off = new periodKey: full cycle fires again.
    expect(detector.observe(2, 2)).toBe(false)
    expect(detector.observe(2, 0)).toBe(true)
  })

  it('does not fire twice when +15 pushes the countdown back positive (once per period)', () => {
    const detector = createRestEdgeDetector()
    detector.observe(1, 1)
    expect(detector.observe(1, 0)).toBe(true)
    // Mid-overage +15: remaining goes positive again, then re-crosses.
    expect(detector.observe(1, 12)).toBe(false)
    expect(detector.observe(1, 0)).toBe(false)
  })

  it('a period that never went positive fires after a later positive observation', () => {
    // Mounted mid-overage, then the user taps +15: the countdown is live
    // again and its crossing is a real, un-alerted edge.
    const detector = createRestEdgeDetector()
    expect(detector.observe(1, -3)).toBe(false)
    expect(detector.observe(1, 12)).toBe(false)
    expect(detector.observe(1, 0)).toBe(true)
  })
})

describe('adjustedRestTarget', () => {
  it('applies the offset to the base target', () => {
    expect(adjustedRestTarget(90, REST_ADJUST_STEP_SEC)).toBe(105)
    expect(adjustedRestTarget(90, -REST_ADJUST_STEP_SEC)).toBe(75)
    expect(adjustedRestTarget(90, 0)).toBe(90)
  })

  it('accumulates multiple taps', () => {
    expect(adjustedRestTarget(60, 3 * REST_ADJUST_STEP_SEC)).toBe(105)
    expect(adjustedRestTarget(60, -2 * REST_ADJUST_STEP_SEC)).toBe(30)
  })

  it('floors at zero — a target never goes negative', () => {
    expect(adjustedRestTarget(20, -45)).toBe(0)
  })

  it('keeps a null base null — no target means nothing to adjust', () => {
    expect(adjustedRestTarget(null, REST_ADJUST_STEP_SEC)).toBe(null)
    expect(adjustedRestTarget(null, -REST_ADJUST_STEP_SEC)).toBe(null)
  })
})

describe('constants', () => {
  it('rest-over vibration is the double-pulse pattern', () => {
    expect(REST_OVER_VIBRATION).toEqual([100, 50, 100])
  })
})
