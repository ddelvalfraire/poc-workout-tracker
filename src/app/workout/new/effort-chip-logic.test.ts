import { describe, it, expect, vi, afterEach } from 'vitest'

import {
  RPE_CHIPS,
  RIR_CHIPS,
  IDLE_COLLAPSE_MS,
  rpeHalfOf,
  nextRpeValue,
  rpeChipAriaLabel,
  rpeTargetChip,
  rirTargetChip,
  createIdleCollapse,
} from './effort-chip-logic'

describe('chip strips', () => {
  it('RPE strip is five whole points 6–10 (no half-point chips)', () => {
    expect([...RPE_CHIPS]).toEqual(['6', '7', '8', '9', '10'])
  })

  it('RIR strip stays 0–5', () => {
    expect([...RIR_CHIPS]).toEqual(['0', '1', '2', '3', '4', '5'])
  })
})

describe('rpeHalfOf', () => {
  it('maps a whole chip to its half point', () => {
    expect(rpeHalfOf('6')).toBe('6.5')
    expect(rpeHalfOf('8')).toBe('8.5')
  })

  it('10 has no half point (scale tops out)', () => {
    expect(rpeHalfOf('10')).toBeNull()
  })
})

describe('nextRpeValue (the two-tap cycle)', () => {
  it('tapping an unselected chip selects its whole point', () => {
    expect(nextRpeValue('', '8')).toBe('8')
  })

  it('tapping a different chip always selects that whole — even from a half', () => {
    expect(nextRpeValue('8', '9')).toBe('9')
    expect(nextRpeValue('8.5', '7')).toBe('7')
  })

  it('tapping the selected whole cycles to its half point', () => {
    expect(nextRpeValue('8', '8')).toBe('8.5')
  })

  it('tapping the half-point selection clears', () => {
    expect(nextRpeValue('8.5', '8')).toBe('')
  })

  it('10 cycles whole → clear (no 10.5 exists)', () => {
    expect(nextRpeValue('10', '10')).toBe('')
  })
})

describe('rpeChipAriaLabel (names the next action)', () => {
  it('unselected chip names its value', () => {
    expect(rpeChipAriaLabel('', '8')).toBe('RPE 8')
  })

  it('selected whole names the half-point next step', () => {
    expect(rpeChipAriaLabel('8', '8')).toBe('RPE 8 — tap again for 8.5')
  })

  it('selected half names the clear next step', () => {
    expect(rpeChipAriaLabel('8.5', '8')).toBe('RPE 8.5 — tap again to clear')
  })

  it('selected 10 names clear directly (no half exists)', () => {
    expect(rpeChipAriaLabel('10', '10')).toBe('RPE 10 — tap again to clear')
  })
})

describe('rpeTargetChip (target-ring placement)', () => {
  it('whole-point target rings its own chip', () => {
    expect(rpeTargetChip(8)).toBe('8')
  })

  it('half-point target rings its whole-point chip — the cycle reaches the half', () => {
    expect(rpeTargetChip(8.5)).toBe('8')
    expect(rpeTargetChip(9.5)).toBe('9')
  })

  it('null / out-of-strip targets ring nothing', () => {
    expect(rpeTargetChip(null)).toBeNull()
    expect(rpeTargetChip(4)).toBeNull()
    expect(rpeTargetChip(11)).toBeNull()
  })
})

describe('rirTargetChip', () => {
  it('in-strip integer targets ring their chip', () => {
    expect(rirTargetChip(0)).toBe('0')
    expect(rirTargetChip(3)).toBe('3')
  })

  it('targets of 5 or more ring the 5+ chip', () => {
    expect(rirTargetChip(5)).toBe('5')
    expect(rirTargetChip(8)).toBe('5')
  })

  it('null / invalid targets ring nothing', () => {
    expect(rirTargetChip(null)).toBeNull()
    expect(rirTargetChip(-1)).toBeNull()
    expect(rirTargetChip(2.5)).toBeNull()
  })
})

describe('createIdleCollapse (5s idle timer)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes the contract-pinned 5000ms constant', () => {
    expect(IDLE_COLLAPSE_MS).toBe(5000)
  })

  it('fires the collapse callback after the idle window', () => {
    vi.useFakeTimers()
    const onCollapse = vi.fn()
    const idle = createIdleCollapse(onCollapse)
    idle.arm()
    vi.advanceTimersByTime(IDLE_COLLAPSE_MS - 1)
    expect(onCollapse).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('re-arming resets the window (interaction keeps the row open)', () => {
    vi.useFakeTimers()
    const onCollapse = vi.fn()
    const idle = createIdleCollapse(onCollapse)
    idle.arm()
    vi.advanceTimersByTime(4000)
    idle.arm() // user touched the row
    vi.advanceTimersByTime(4000)
    expect(onCollapse).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('clear cancels the pending collapse (unmount path)', () => {
    vi.useFakeTimers()
    const onCollapse = vi.fn()
    const idle = createIdleCollapse(onCollapse)
    idle.arm()
    idle.clear()
    vi.advanceTimersByTime(IDLE_COLLAPSE_MS * 2)
    expect(onCollapse).not.toHaveBeenCalled()
  })

  it('never fires twice for one arm', () => {
    vi.useFakeTimers()
    const onCollapse = vi.fn()
    const idle = createIdleCollapse(onCollapse)
    idle.arm()
    vi.advanceTimersByTime(IDLE_COLLAPSE_MS * 3)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })
})
