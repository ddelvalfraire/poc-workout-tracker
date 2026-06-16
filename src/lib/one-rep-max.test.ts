import { describe, it, expect } from 'vitest'
import { estimate1RM, bestSet } from './one-rep-max'

describe('estimate1RM', () => {
  it('returns the weight itself for a single rep (a single is its own 1RM)', () => {
    expect(estimate1RM(1, 100)).toBe(100)
  })

  it('applies the Epley formula for multi-rep sets', () => {
    // 100 × (1 + 5/30) = 116.666…
    expect(estimate1RM(5, 100)).toBeCloseTo(116.667, 3)
  })

  it('returns null when reps are blank', () => {
    expect(estimate1RM(null, 100)).toBe(null)
  })

  it('returns null when weight is blank', () => {
    expect(estimate1RM(5, null)).toBe(null)
  })

  it('returns null for zero reps', () => {
    expect(estimate1RM(0, 100)).toBe(null)
  })

  it('returns null for zero weight', () => {
    expect(estimate1RM(5, 0)).toBe(null)
  })

  it('returns null for non-finite input', () => {
    expect(estimate1RM(Infinity, 100)).toBe(null)
    expect(estimate1RM(5, NaN)).toBe(null)
  })
})

describe('bestSet', () => {
  it('picks the set with the highest estimated 1RM', () => {
    // 5×100 → 116.67 ; 3×110 → 121 → the heavier estimate wins
    const best = bestSet([
      { reps: 5, weight: 100 },
      { reps: 3, weight: 110 },
    ])
    expect(best?.reps).toBe(3)
    expect(best?.weightKg).toBe(110)
    expect(best?.e1rm).toBeCloseTo(121, 5) // 110 × (1 + 3/30), full float precision
  })

  it('returns null when no set has both reps and weight', () => {
    expect(bestSet([{ reps: null, weight: null }])).toBe(null)
  })

  it('returns null for an empty list', () => {
    expect(bestSet([])).toBe(null)
  })

  it('ignores blank sets and selects from the rest', () => {
    const best = bestSet([
      { reps: null, weight: null },
      { reps: 5, weight: 100 },
    ])
    expect(best?.reps).toBe(5)
    expect(best?.weightKg).toBe(100)
  })

  it('resolves ties to the first qualifying set', () => {
    const best = bestSet([
      { reps: 5, weight: 100 },
      { reps: 5, weight: 100 },
    ])
    expect(best).toEqual({ reps: 5, weightKg: 100, e1rm: estimate1RM(5, 100) })
  })
})
