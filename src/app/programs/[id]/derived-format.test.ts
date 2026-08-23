import { describe, it, expect } from 'vitest'
import { renderMessageIn } from '../../../../vitest.intl'
import { targetCells, targetMarks, groupDerivedSets } from './derived-format'
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

describe('targetCells', () => {
  it('resolves a run into CELLS, not a compound string', () => {
    // The whole point of the redesign: "3×5 @ 105 kg" was ambiguous by
    // construction (sets-vs-reps ordering is genuinely contested), so each
    // number now lands under its own declared column header.
    expect(targetCells(derivedSet(), 3, 'kg')).toMatchObject({
      sets: '3',
      reps: '5',
      load: '105 kg',
      effort: null,
      span: null,
      tempo: null,
      marks: [],
    })
  })

  it('collapses an equal rep range and converts the load to the display unit', () => {
    expect(targetCells(derivedSet({ repMin: 8, repMax: 12 }), 2, 'kg').reps).toBe('8–12')
    expect(targetCells(derivedSet({ loadKg: 100 }), 1, 'lb').load).toBe('220.5 lb')
  })

  it('formats the load through Intl for the locale, not by concatenation', () => {
    const expected = new Intl.NumberFormat('en', {
      style: 'unit',
      unit: 'kilogram',
      unitDisplay: 'short',
    }).format(105)
    expect(targetCells(derivedSet(), 3, 'kg', 'en').load).toBe(expected)
  })

  it('leaves reps and load null rather than inventing a placeholder', () => {
    // The table renders the em dash; the formatter refuses to decide what an
    // absent value LOOKS like, which is the caller's business.
    const bare = derivedSet({ repMin: null, repMax: null, loadKg: null })
    expect(targetCells(bare, 1, 'kg')).toMatchObject({ sets: '1', reps: null, load: null })
  })

  it('speaks ONE effort dialect, preferring RIR when a row carries both', () => {
    // RPE 8 and 2 RIR are the same fact stated twice — a row showing both
    // says nothing extra and costs a column.
    expect(targetCells(derivedSet({ rir: 2 }), 3, 'kg').effort).toEqual({
      value: '2',
      kind: 'rir',
    })
    expect(targetCells(derivedSet({ rpe: 8 }), 3, 'kg').effort).toEqual({
      value: '8',
      kind: 'rpe',
    })
    expect(targetCells(derivedSet({ rpe: 8, rir: 2 }), 3, 'kg').effort).toEqual({
      value: '2',
      kind: 'rir',
    })
  })

  it('gives timed and distance runs a span instead of empty rep/load columns', () => {
    const timed = targetCells(derivedSet({ metricMode: 'duration', durationSec: 60 }), 3, 'kg')
    expect(timed).toMatchObject({ sets: '3', reps: null, load: null, span: '60s' })

    const both = targetCells(
      derivedSet({ metricMode: 'duration_distance', durationSec: 120, distanceM: 400 }),
      1,
      'kg',
    )
    expect(both.span).toBe('120s / 400 m')
  })

  it('keeps tempo out of the columns — it is rare and belongs subordinate', () => {
    expect(targetCells(derivedSet({ tempo: '3-1-1-0' }), 3, 'kg').tempo).toBe('3-1-1-0')
  })
})

describe('targetMarks', () => {
  it('marks a deload run with the pair the block map already uses', () => {
    // One glyph, one meaning: DL means deload in the week strip, so it means
    // deload here too.
    expect(targetMarks(derivedSet({ derivedFrom: 'deload' }))).toEqual([
      { letter: 'DL', key: 'day.deloadLabel' },
    ])
  })

  it('marks each technique with a distinct two-letter pair', () => {
    const kinds = ['drop-set', 'rest-pause', 'myo-reps', 'cluster'] as const
    const letters = kinds.map(
      (kind) =>
        targetMarks(
          derivedSet({ technique: { version: 1, kind, stages: [{ loadKg: 80, reps: 8 }] } }),
        )[0].letter,
    )
    // Two letters rather than one because "drop set" and "deload" both start
    // with D — a mark that collides teaches nothing.
    expect(new Set(letters).size).toBe(kinds.length)
    expect(letters.every((letter) => letter.length === 2)).toBe(true)
  })

  it('carries deload AND technique together — they are different axes', () => {
    const marks = targetMarks(
      derivedSet({
        derivedFrom: 'deload',
        technique: { version: 1, kind: 'myo-reps', stages: [{ loadKg: 80, reps: 8 }] },
      }),
    )
    expect(marks.map((m) => m.letter)).toEqual(['DL', 'MR'])
  })

  it('stays silent for every derivedFrom that is not a deload', () => {
    // 'scheme'/'template'/'override' are HOW the number was computed — the
    // progression sentence's job — and 'autoreg' speaks at week level in its
    // own section rather than whispering on a row.
    for (const derivedFrom of ['template', 'scheme', 'override', 'autoreg'] as const) {
      expect(targetMarks(derivedSet({ derivedFrom }))).toEqual([])
    }
  })

  it('resolves every mark label through the real catalog', () => {
    for (const kind of ['drop-set', 'rest-pause', 'myo-reps', 'cluster'] as const) {
      const [mark] = targetMarks(
        derivedSet({ technique: { version: 1, kind, stages: [{ loadKg: 80, reps: 8 }] } }),
      )
      expect(renderMessageIn('ProgramDetail', { key: mark.key, values: {} })).not.toMatch(
        /ProgramDetail\.[a-zA-Z.]+/,
      )
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
