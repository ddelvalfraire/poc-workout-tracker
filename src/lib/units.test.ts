import { describe, it, expect } from 'vitest'
import {
  kgToDisplay,
  displayToKg,
  isWeightUnit,
  DEFAULT_WEIGHT_UNIT,
  lengthUnitFor,
  cmToDisplay,
  displayToCm,
} from './units'

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

describe('lengthUnitFor', () => {
  it('infers inches from the lb weight preference (one preference governs both)', () => {
    expect(lengthUnitFor('lb')).toBe('in')
  })

  it('infers cm from the kg weight preference', () => {
    expect(lengthUnitFor('kg')).toBe('cm')
  })
})

describe('cmToDisplay', () => {
  it('is the identity for cm (canonical unit, full precision preserved)', () => {
    expect(cmToDisplay(85.25, 'cm')).toBe(85.25)
  })

  it('converts cm to inches, rounded to 1dp', () => {
    // 85 / 2.54 = 33.464… → 33.5
    expect(cmToDisplay(85, 'in')).toBe(33.5)
  })

  it('rounds the inch conversion down when the fraction falls under .05', () => {
    // 84 / 2.54 = 33.070… → 33.1
    expect(cmToDisplay(84, 'in')).toBe(33.1)
  })
})

describe('displayToCm', () => {
  it('rounds the cm identity path to column precision (2dp)', () => {
    expect(displayToCm(85.256, 'cm')).toBe(85.26)
  })

  it('converts inches back to cm at 2dp', () => {
    // 33.5 in × 2.54 = 85.09 exactly
    expect(displayToCm(33.5, 'in')).toBe(85.09)
  })

  it('round-trips a typical inch entry within display rounding', () => {
    expect(cmToDisplay(displayToCm(33.5, 'in'), 'in')).toBe(33.5)
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
