import { describe, it, expect } from 'vitest'
import { estimate1RM, bestSet, effectiveLoadKg, bestScoredSet } from './one-rep-max'

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

describe('effectiveLoadKg', () => {
  it('returns the entered weight verbatim for weight_reps', () => {
    expect(effectiveLoadKg('weight_reps', 100, 80)).toBe(100)
  })

  it('keeps null weight null for weight_reps (blank stays blank)', () => {
    expect(effectiveLoadKg('weight_reps', null, 80)).toBe(null)
  })

  it('scores bodyweight_reps as the bodyweight itself, ignoring any entered weight', () => {
    expect(effectiveLoadKg('bodyweight_reps', 25, 80)).toBe(80)
    expect(effectiveLoadKg('bodyweight_reps', null, 80)).toBe(80)
  })

  it('adds the entered load on top of bodyweight for weighted_bodyweight', () => {
    expect(effectiveLoadKg('weighted_bodyweight', 25, 80)).toBe(105)
  })

  it('treats a blank added load as +0 for weighted_bodyweight', () => {
    expect(effectiveLoadKg('weighted_bodyweight', null, 80)).toBe(80)
  })

  it('subtracts the assistance from bodyweight for assisted_bodyweight', () => {
    expect(effectiveLoadKg('assisted_bodyweight', 20, 80)).toBe(60)
  })

  it('treats blank assistance as −0 for assisted_bodyweight', () => {
    expect(effectiveLoadKg('assisted_bodyweight', null, 80)).toBe(80)
  })

  it('returns null when assistance meets or exceeds bodyweight (no positive load)', () => {
    expect(effectiveLoadKg('assisted_bodyweight', 80, 80)).toBe(null)
    expect(effectiveLoadKg('assisted_bodyweight', 100, 80)).toBe(null)
  })

  it('returns null for every bodyweight type when bodyweight is unknown', () => {
    expect(effectiveLoadKg('bodyweight_reps', null, null)).toBe(null)
    expect(effectiveLoadKg('weighted_bodyweight', 25, null)).toBe(null)
    expect(effectiveLoadKg('assisted_bodyweight', 20, null)).toBe(null)
  })

  it('returns null for a non-positive or non-finite bodyweight', () => {
    expect(effectiveLoadKg('bodyweight_reps', null, 0)).toBe(null)
    expect(effectiveLoadKg('bodyweight_reps', null, NaN)).toBe(null)
  })
})

describe('bestScoredSet', () => {
  it('scores weight_reps sets like bestSet, tagging the winning index', () => {
    // 5×100 → 116.67 ; 3×110 → 121 → the heavier estimate wins
    const best = bestScoredSet(
      [
        { reps: 5, weight: 100 },
        { reps: 3, weight: 110 },
      ],
      'weight_reps',
      null,
    )
    expect(best).toMatchObject({ kind: 'e1rm', index: 1, reps: 3, weightKg: 110 })
  })

  it('resolves e1rm ties to the earliest set', () => {
    const best = bestScoredSet(
      [
        { reps: 5, weight: 100 },
        { reps: 5, weight: 100 },
      ],
      'weight_reps',
      null,
    )
    expect(best).toMatchObject({ kind: 'e1rm', index: 0 })
  })

  it('scores bodyweight sets over the effective load when bodyweight is known', () => {
    // BW 80: +25 → 105 kg effective; +10 → 90 kg. 5×105 beats 8×90? 105×1.1667=122.5 vs 90×1.2667=114 → first wins.
    const best = bestScoredSet(
      [
        { reps: 5, weight: 25 },
        { reps: 8, weight: 10 },
      ],
      'weighted_bodyweight',
      80,
    )
    expect(best).toMatchObject({ kind: 'e1rm', index: 0, reps: 5, weightKg: 105 })
  })

  it('falls back to most reps when no set is e1rm-scorable (BW type, no bodyweight)', () => {
    const best = bestScoredSet(
      [
        { reps: 8, weight: null },
        { reps: 12, weight: null },
        { reps: 10, weight: null },
      ],
      'bodyweight_reps',
      null,
    )
    expect(best).toEqual({ kind: 'reps', index: 1, reps: 12 })
  })

  it('falls back to most reps for weight_reps sets logged without weight', () => {
    // The user's report: "top set" broke when no weight was entered.
    const best = bestScoredSet(
      [
        { reps: 10, weight: null },
        { reps: 15, weight: null },
      ],
      'weight_reps',
      null,
    )
    expect(best).toEqual({ kind: 'reps', index: 1, reps: 15 })
  })

  it('never uses the rep fallback while any set is e1rm-scorable', () => {
    const best = bestScoredSet(
      [
        { reps: 20, weight: null },
        { reps: 5, weight: 100 },
      ],
      'weight_reps',
      null,
    )
    expect(best).toMatchObject({ kind: 'e1rm', index: 1 })
  })

  it('resolves rep-fallback ties to the earliest set', () => {
    const best = bestScoredSet(
      [
        { reps: 12, weight: null },
        { reps: 12, weight: null },
      ],
      'bodyweight_reps',
      null,
    )
    expect(best).toEqual({ kind: 'reps', index: 0, reps: 12 })
  })

  it('excludes zero-rep and blank sets from the rep fallback', () => {
    expect(
      bestScoredSet(
        [
          { reps: 0, weight: null },
          { reps: null, weight: null },
        ],
        'bodyweight_reps',
        null,
      ),
    ).toBe(null)
  })

  it('returns null for an empty list', () => {
    expect(bestScoredSet([], 'weight_reps', 80)).toBe(null)
  })
})
