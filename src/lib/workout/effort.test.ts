import { describe, it, expect } from 'vitest'
import { isValidRir, isValidRpe, effortLabel, shouldShowEffortRow } from './effort'

describe('isValidRir', () => {
  it('accepts integers 0 through 10', () => {
    for (const v of [0, 1, 5, 10]) expect(isValidRir(v)).toBe(true)
  })

  it('rejects negatives, fractions, out-of-range, and non-finite values', () => {
    expect(isValidRir(-1)).toBe(false)
    expect(isValidRir(2.5)).toBe(false)
    expect(isValidRir(11)).toBe(false)
    expect(isValidRir(NaN)).toBe(false)
    expect(isValidRir(Infinity)).toBe(false)
  })
})

describe('isValidRpe', () => {
  it('accepts 4 through 10 in half-point steps', () => {
    for (const v of [4, 4.5, 6, 8.5, 9.5, 10]) expect(isValidRpe(v)).toBe(true)
  })

  it('rejects off-step, out-of-range, and non-finite values', () => {
    expect(isValidRpe(3.5)).toBe(false)
    expect(isValidRpe(10.5)).toBe(false)
    expect(isValidRpe(8.25)).toBe(false)
    expect(isValidRpe(NaN)).toBe(false)
    expect(isValidRpe(Infinity)).toBe(false)
  })
})

describe('effortLabel', () => {
  it('renders RIR alone', () => {
    expect(effortLabel(2, null)).toBe('RIR 2')
  })

  it('renders RPE alone, half points intact', () => {
    expect(effortLabel(null, 8.5)).toBe('RPE 8.5')
  })

  it('renders both when both were logged (RIR first)', () => {
    expect(effortLabel(1, 9)).toBe('RIR 1 · RPE 9')
  })

  it('is null when neither is present', () => {
    expect(effortLabel(null, null)).toBeNull()
  })
})

describe('shouldShowEffortRow', () => {
  it('shows when the set carries a prescribed RIR target', () => {
    expect(shouldShowEffortRow({ rir: 2, rpe: null }, false)).toBe(true)
  })

  it('shows when the set carries a prescribed RPE target', () => {
    expect(shouldShowEffortRow({ rir: null, rpe: 8 }, false)).toBe(true)
  })

  it('shows when the user preference is on, even without a target', () => {
    expect(shouldShowEffortRow(undefined, true)).toBe(true)
    expect(shouldShowEffortRow({ rir: null, rpe: null }, true)).toBe(true)
  })

  it('hides when there is no target and the preference is off', () => {
    expect(shouldShowEffortRow(undefined, false)).toBe(false)
    expect(shouldShowEffortRow({ rir: null, rpe: null }, false)).toBe(false)
  })

  it('treats absent target fields as no target', () => {
    expect(shouldShowEffortRow({}, false)).toBe(false)
  })
})
