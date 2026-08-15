import { describe, expect, it } from 'vitest'
import {
  LOAD_INCREMENT_KG,
  LOAD_INCREMENT_LB,
  loadsMatch,
  quantizeAdjustedLoadKg,
  quantizeDisplayLoad,
  quantizeLoadKg,
  quantizeSetLoads,
} from './load-quantize'

describe('quantizeLoadKg', () => {
  it('exposes the standard increments', () => {
    expect(LOAD_INCREMENT_LB).toBe(2.5)
    expect(LOAD_INCREMENT_KG).toBe(1.25)
  })

  it('snaps a kg-derived load onto the lb grid (the 37.2 lb bug)', () => {
    // 16.87 kg displays as 37.2 lb raw; the nearest 2.5 lb multiple is 37.5.
    expect(quantizeLoadKg(16.87, 'lb')).toBe(17.01) // 37.5 lb at column precision
    expect(quantizeDisplayLoad(16.87, 'lb')).toBe(37.5)
  })

  it('snaps the 66.6 lb reason-string load to 67.5 lb', () => {
    // 30.21 kg displays as 66.6 lb raw; nearest 2.5 lb multiple is 67.5.
    expect(quantizeDisplayLoad(30.21, 'lb')).toBe(67.5)
  })

  it('snaps kg loads to 1.25 kg multiples', () => {
    expect(quantizeLoadKg(101.7, 'kg')).toBe(101.25)
    expect(quantizeDisplayLoad(101.7, 'kg')).toBe(101.25)
    expect(quantizeLoadKg(102.2, 'kg')).toBe(102.5)
  })

  it('leaves on-grid values unchanged (kg identity, lb round-trip stable)', () => {
    expect(quantizeLoadKg(100, 'kg')).toBe(100)
    expect(quantizeDisplayLoad(100, 'lb')).toBe(220) // 220.5 raw → 220 on the grid
    // Idempotent: re-quantizing a quantized value is a no-op.
    const once = quantizeLoadKg(16.87, 'lb')
    expect(quantizeLoadKg(once, 'lb')).toBe(once)
  })

  it('rounds ties up', () => {
    // 1.875 kg sits exactly between 1.25 and 2.5.
    expect(quantizeLoadKg(1.875, 'kg')).toBe(2.5)
  })

  it('clamps zero, negatives, and non-finite input to 0', () => {
    expect(quantizeLoadKg(0, 'kg')).toBe(0)
    expect(quantizeLoadKg(-5, 'lb')).toBe(0)
    expect(quantizeLoadKg(Number.NaN, 'kg')).toBe(0)
  })

  it('clamps a strictly-positive sub-half-increment load UP to one increment, never 0', () => {
    expect(quantizeLoadKg(0.3, 'kg')).toBe(LOAD_INCREMENT_KG)
    expect(quantizeLoadKg(0.2, 'lb')).toBe(1.13) // 2.5 lb at column precision
    expect(quantizeDisplayLoad(0.2, 'lb')).toBe(LOAD_INCREMENT_LB)
  })
})

describe('quantizeAdjustedLoadKg (anti-fixed-point)', () => {
  it('steps down one increment when a reduction quantizes back to its baseline (5 lb loop)', () => {
    // 2.27 kg is 5 lb; a 25% backoff lands at 1.7025 kg = 3.75 lb, whose
    // nearest 2.5 lb multiple rounds BACK UP to 5 lb — the fixed point.
    expect(quantizeAdjustedLoadKg(1.7025, 2.27, 'lb')).toBe(1.13) // 2.5 lb
  })

  it('steps up one increment when an intended increase rounds back down', () => {
    // 2.4 kg is 5.29 lb, which quantizes back to 5 lb — same as baseline.
    expect(quantizeAdjustedLoadKg(2.4, 2.27, 'lb')).toBe(3.4) // 7.5 lb
  })

  it('passes a normally-resolving adjustment straight through', () => {
    expect(quantizeAdjustedLoadKg(90, 100, 'kg')).toBe(90)
  })

  it('never steps a reduction below the smallest loadable increment', () => {
    // Backing off 1.13 kg (2.5 lb) would step to 0 — hold the floor instead.
    expect(quantizeAdjustedLoadKg(0.8475, 1.13, 'lb')).toBe(1.13)
  })
})

describe('loadsMatch', () => {
  it('matches within the raw epsilon regardless of unit', () => {
    expect(loadsMatch(100, 100.03, 0.05)).toBe(true)
    expect(loadsMatch(100, 100.03, 0.05, 'lb')).toBe(true)
  })

  it('rejects beyond-epsilon values without a unit', () => {
    expect(loadsMatch(16.87, 17.01, 0.05)).toBe(false)
  })

  it('matches a legacy unquantized snapshot with its quantized re-derivation', () => {
    // 16.87 kg and 17.01 kg both display as 37.5 lb on the 2.5 lb grid.
    expect(loadsMatch(16.87, 17.01, 0.05, 'lb')).toBe(true)
  })

  it('rejects values in different increments of the unit grid', () => {
    expect(loadsMatch(16.87, 18.5, 0.05, 'lb')).toBe(false) // 37.5 vs 40 lb
  })
})

describe('quantizeSetLoads', () => {
  it('quantizes loadKg and schemeLoadKg, preserving every other field', () => {
    const set = { loadKg: 16.87, schemeLoadKg: 30.21, repMin: 8, repMax: 12 }
    expect(quantizeSetLoads(set, 'lb')).toEqual({
      loadKg: 17.01,
      schemeLoadKg: 30.62, // 67.5 lb
      repMin: 8,
      repMax: 12,
    })
    // Input is never mutated.
    expect(set.loadKg).toBe(16.87)
  })

  it('passes null loads through and returns the same object when nothing moves', () => {
    const loadless = { loadKg: null, repMin: 8, repMax: 12 }
    expect(quantizeSetLoads(loadless, 'lb')).toBe(loadless)
    const onGrid = { loadKg: 100, schemeLoadKg: null }
    expect(quantizeSetLoads(onGrid, 'kg')).toBe(onGrid)
  })
})
