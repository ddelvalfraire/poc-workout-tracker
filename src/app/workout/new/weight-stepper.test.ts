import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOLD_ACCEL_AFTER,
  HOLD_ACCEL_FACTOR,
  HOLD_DELAY_MS,
  HOLD_INTERVAL_MS,
  createHoldRepeater,
  holdRepeatDelay,
  holdStepMultiplier,
  stepWeightValueBy,
} from './weight-stepper'

describe('holdRepeatDelay', () => {
  it('waits the long press-in delay before the first repeat', () => {
    expect(holdRepeatDelay(0)).toBe(HOLD_DELAY_MS)
  })

  it('runs every later repeat at the fast interval', () => {
    expect(holdRepeatDelay(1)).toBe(HOLD_INTERVAL_MS)
    expect(holdRepeatDelay(7)).toBe(HOLD_INTERVAL_MS)
    expect(holdRepeatDelay(20)).toBe(HOLD_INTERVAL_MS)
  })
})

describe('holdStepMultiplier', () => {
  it('steps 1× until the acceleration threshold', () => {
    expect(holdStepMultiplier(0)).toBe(1)
    expect(holdStepMultiplier(HOLD_ACCEL_AFTER - 1)).toBe(1)
  })

  it('multiplies the step after HOLD_ACCEL_AFTER repeats', () => {
    expect(holdStepMultiplier(HOLD_ACCEL_AFTER)).toBe(HOLD_ACCEL_FACTOR)
    expect(holdStepMultiplier(HOLD_ACCEL_AFTER + 5)).toBe(HOLD_ACCEL_FACTOR)
  })
})

describe('createHoldRepeater', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a tap (stop before the first delay) fires nothing — one step stays one step', () => {
    // Arrange
    const fire = vi.fn()
    const repeater = createHoldRepeater(fire)

    // Act — press, release just before the 400ms delay elapses
    repeater.start()
    vi.advanceTimersByTime(HOLD_DELAY_MS - 1)
    repeater.stop()
    vi.advanceTimersByTime(10_000)

    // Assert
    expect(fire).not.toHaveBeenCalled()
  })

  it('holds: first repeat at the delay, then one per interval', () => {
    const fire = vi.fn()
    const repeater = createHoldRepeater(fire)

    repeater.start()
    vi.advanceTimersByTime(HOLD_DELAY_MS)
    expect(fire).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(HOLD_INTERVAL_MS * 3)
    expect(fire).toHaveBeenCalledTimes(4)

    repeater.stop()
  })

  it('accelerates to the 5× multiplier after 8 repeats', () => {
    const fire = vi.fn()
    const repeater = createHoldRepeater(fire)

    // Act — run long enough for the threshold plus two accelerated repeats
    repeater.start()
    vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_INTERVAL_MS * (HOLD_ACCEL_AFTER + 1))
    repeater.stop()

    // Assert — repeats 1..8 at 1×, repeats 9+ at 5×
    expect(fire.mock.calls.map(([multiplier]) => multiplier)).toEqual([
      ...Array.from({ length: HOLD_ACCEL_AFTER }, () => 1),
      HOLD_ACCEL_FACTOR,
      HOLD_ACCEL_FACTOR,
    ])
  })

  it('stop() cancels a running chain — nothing fires afterwards', () => {
    const fire = vi.fn()
    const repeater = createHoldRepeater(fire)

    repeater.start()
    vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_INTERVAL_MS)
    expect(fire).toHaveBeenCalledTimes(2)

    repeater.stop()
    vi.advanceTimersByTime(10_000)
    expect(fire).toHaveBeenCalledTimes(2)
  })

  it('start() restarts the schedule from the long delay', () => {
    const fire = vi.fn()
    const repeater = createHoldRepeater(fire)

    repeater.start()
    vi.advanceTimersByTime(HOLD_DELAY_MS - 1)
    repeater.start() // re-press before the first repeat
    vi.advanceTimersByTime(HOLD_DELAY_MS - 1)
    expect(fire).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
    repeater.stop()
  })
})

describe('stepWeightValueBy', () => {
  it('matches a single stepWeightValue tap at 1×', () => {
    expect(stepWeightValueBy('60', undefined, 1, 'kg', 1)).toBe('62.5')
    expect(stepWeightValueBy('60', undefined, -1, 'kg', 1)).toBe('57.5')
  })

  it('chains the unit step for accelerated repeats', () => {
    // Arrange + Act — one 5× repeat in kg (5 × 2.5) and lb (5 × 5)
    expect(stepWeightValueBy('60', undefined, 1, 'kg', 5)).toBe('72.5')
    expect(stepWeightValueBy('135', undefined, 1, 'lb', 5)).toBe('160')
  })

  it('seeds from the ghost exactly like a single tap', () => {
    expect(stepWeightValueBy('', '100', 1, 'kg', 5)).toBe('112.5')
  })

  it('clamps at the 0 floor mid-chain instead of overshooting negative', () => {
    // 5 kg − 5 × 2.5 kg would be −7.5; the chain floors at 0 and stays there
    expect(stepWeightValueBy('5', undefined, -1, 'kg', 5)).toBe('0')
  })

  it('passes non-numeric text through as null — never clobbers typed text', () => {
    expect(stepWeightValueBy('60-70', undefined, 1, 'kg', 5)).toBeNull()
  })
})
