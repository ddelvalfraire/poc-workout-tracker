import { describe, it, expect } from 'vitest'
import { formatTargetLine, groupDerivedSets } from './derived-format'
import type { DerivedSet } from '@/lib/progression'

/** A derived working set with every optional target nulled, for overriding. */
function derivedSet(overrides: Partial<DerivedSet> = {}): DerivedSet {
  return {
    setNumber: 1,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: 5,
    repMax: 5,
    rir: null,
    rpe: null,
    loadKg: 105,
    tempo: null,
    durationSec: null,
    distanceM: null,
    technique: null,
    derivedFrom: 'template',
    sourceIndex: 0,
    ...overrides,
  }
}

describe('formatTargetLine', () => {
  it('collapses an equal rep range and shows the load in the display unit', () => {
    expect(formatTargetLine(derivedSet(), 3, 'kg')).toBe('3×5 @ 105 kg')
    expect(formatTargetLine(derivedSet({ loadKg: 100 }), 1, 'lb')).toBe('1×5 @ 220.5 lb')
  })

  it('renders a true range and reps-only when the load is null (no crash)', () => {
    const set = derivedSet({ repMin: 8, repMax: 12, loadKg: null })
    expect(formatTargetLine(set, 2, 'kg')).toBe('2×8–12 reps')
  })

  it('pluralizes the bare-count fallback correctly', () => {
    const bare = derivedSet({ repMin: null, repMax: null, loadKg: null })
    expect(formatTargetLine(bare, 1, 'kg')).toBe('1 set')
    expect(formatTargetLine(bare, 3, 'kg')).toBe('3 sets')
  })

  it('appends RPE, RIR, and tempo when present', () => {
    const set = derivedSet({ rpe: 8, rir: 2, tempo: '3-1-1' })
    expect(formatTargetLine(set, 3, 'kg')).toBe('3×5 @ 105 kg · RPE 8 · RIR 2 · 3-1-1 tempo')
  })

  it('renders timed sets from durationSec (and distance when present)', () => {
    expect(formatTargetLine(derivedSet({ metricMode: 'duration', durationSec: 60 }), 3, 'kg')).toBe(
      '3×60s',
    )
    expect(
      formatTargetLine(
        derivedSet({ metricMode: 'duration_distance', durationSec: 120, distanceM: 400 }),
        1,
        'kg',
      ),
    ).toBe('1×120s / 400 m')
  })
})

describe('groupDerivedSets', () => {
  it('collapses consecutive identical prescriptions into one counted run', () => {
    // Arrange — 3 identical working sets, then a lighter backoff
    const sets = [
      derivedSet({ setNumber: 1 }),
      derivedSet({ setNumber: 2 }),
      derivedSet({ setNumber: 3 }),
      derivedSet({ setNumber: 4, setType: 'backoff', loadKg: 90 }),
    ]

    // Act
    const groups = groupDerivedSets(sets)

    // Assert
    expect(groups.map((g) => g.count)).toEqual([3, 1])
    expect(groups[1].set.loadKg).toBe(90)
  })

  it('splits runs when tempo, RIR, or technique differ (now that they render)', () => {
    const technique = {
      version: 1 as const,
      kind: 'drop-set' as const,
      stages: [{ loadKg: 80, reps: 8 }],
    }
    const sets = [
      derivedSet(),
      derivedSet({ tempo: '3-1-1' }),
      derivedSet({ rir: 2 }),
      derivedSet({ technique }),
      derivedSet({ technique }),
    ]

    const groups = groupDerivedSets(sets)

    expect(groups.map((g) => g.count)).toEqual([1, 1, 1, 2])
    expect(groups[3].set.technique).toEqual(technique)
  })

  it('keeps deload and non-deload sets in separate groups', () => {
    const sets = [derivedSet(), derivedSet({ derivedFrom: 'deload', loadKg: 89.25 })]
    expect(groupDerivedSets(sets)).toHaveLength(2)
  })
})
