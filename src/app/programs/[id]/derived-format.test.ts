import { describe, it, expect } from 'vitest'
import { renderMessageIn } from '../../../../vitest.intl'
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
    restSec: null,
    technique: null,
    derivedFrom: 'template',
    sourceIndex: 0,
    ...overrides,
  }
}

/** The line the page renders: every segment through the real catalog, joined
 *  with the middot the detail page joins them with. */
const line = (...args: Parameters<typeof formatTargetLine>) =>
  formatTargetLine(...args)
    .map((segment) => renderMessageIn('ProgramDetail', segment))
    .join(' · ')

describe('formatTargetLine', () => {
  it('decides the core segment and the tail segments, not a sentence', () => {
    expect(formatTargetLine(derivedSet(), 3, 'kg')).toEqual([
      { key: 'target.load', values: { count: 3, reps: '5', load: '105 kg' } },
    ])
    expect(formatTargetLine(derivedSet({ rpe: 8, rir: 2, tempo: '3-1-1' }), 3, 'kg').map(
      (segment) => segment.key,
    )).toEqual(['target.load', 'target.rpe', 'target.rir', 'target.tempo'])
  })

  it('collapses an equal rep range and shows the load in the display unit', () => {
    expect(line(derivedSet(), 3, 'kg')).toBe('3×5 @ 105 kg')
    expect(line(derivedSet({ loadKg: 100 }), 1, 'lb')).toBe('1×5 @ 220.5 lb')
  })

  it('formats the load through Intl for the locale, not by concatenation', () => {
    const expected = new Intl.NumberFormat('en', {
      style: 'unit',
      unit: 'kilogram',
      unitDisplay: 'short',
      useGrouping: false,
    }).format(105)
    expect(line(derivedSet(), 3, 'kg', 'en')).toContain(expected)
  })

  it('renders a true range and reps-only when the load is null (no crash)', () => {
    const set = derivedSet({ repMin: 8, repMax: 12, loadKg: null })
    expect(line(set, 2, 'kg')).toBe('2×8–12 reps')
  })

  // Singular and plural asserted separately — the count used to build its own
  // `set`/`sets`, which no other language can repair downstream.
  it('pluralizes the bare-count fallback correctly', () => {
    const bare = derivedSet({ repMin: null, repMax: null, loadKg: null })
    expect(line(bare, 1, 'kg')).toBe('1 set')
    expect(line(bare, 3, 'kg')).toBe('3 sets')
  })

  it('appends RPE, RIR, and tempo when present', () => {
    const set = derivedSet({ rpe: 8, rir: 2, tempo: '3-1-1' })
    expect(line(set, 3, 'kg')).toBe('3×5 @ 105 kg · RPE 8 · RIR 2 · 3-1-1 tempo')
  })

  it('renders timed sets from durationSec (and distance when present)', () => {
    expect(line(derivedSet({ metricMode: 'duration', durationSec: 60 }), 3, 'kg')).toBe('3×60s')
    expect(
      line(
        derivedSet({ metricMode: 'duration_distance', durationSec: 120, distanceM: 400 }),
        1,
        'kg',
      ),
    ).toBe('1×120s / 400 m')
  })

  it('leaves no unresolved key path in any branch', () => {
    for (const set of [
      derivedSet(),
      derivedSet({ repMin: 8, repMax: 12, loadKg: null }),
      derivedSet({ repMin: null, repMax: null, loadKg: null }),
      derivedSet({ rpe: 8, rir: 2, tempo: '3-1-1' }),
      derivedSet({ metricMode: 'duration', durationSec: 60 }),
      derivedSet({ metricMode: 'duration_distance', durationSec: 120, distanceM: 400 }),
    ]) {
      expect(line(set, 2, 'kg')).not.toMatch(/ProgramDetail\.[a-zA-Z.]+/)
    }
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
