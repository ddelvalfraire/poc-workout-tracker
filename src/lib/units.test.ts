import { describe, it, expect } from 'vitest'
import { kgToDisplay, displayToKg, isWeightUnit, DEFAULT_WEIGHT_UNIT } from './units'

describe('DEFAULT_WEIGHT_UNIT', () => {
  it('is lb (product default for unconfigured users)', () => {
    expect(DEFAULT_WEIGHT_UNIT).toBe('lb')
  })
})

describe('kgToDisplay', () => {
  it('is the identity for kg', () => {
    expect(kgToDisplay(100, 'kg')).toBe(100)
  })

  it('preserves fractional plate weights for kg', () => {
    expect(kgToDisplay(2.5, 'kg')).toBe(2.5)
  })

  it('preserves sub-0.1 kg precision (no display rounding on the kg path)', () => {
    expect(kgToDisplay(1.25, 'kg')).toBe(1.25)
  })

  it('converts kg to lb, rounded to 1dp', () => {
    expect(kgToDisplay(100, 'lb')).toBe(220.5)
  })
})

describe('displayToKg', () => {
  it('is the identity for kg', () => {
    expect(displayToKg(100, 'kg')).toBe(100)
  })

  it('converts lb back to kg at 2dp', () => {
    // 220.5 lb × 0.45359237 = 100.017… → 100.02 at column precision
    expect(displayToKg(220.5, 'lb')).toBeCloseTo(100.02, 2)
  })
})

describe('isWeightUnit', () => {
  it('accepts kg and lb', () => {
    expect(isWeightUnit('kg')).toBe(true)
    expect(isWeightUnit('lb')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isWeightUnit('stone')).toBe(false)
    expect(isWeightUnit(undefined)).toBe(false)
  })
})
