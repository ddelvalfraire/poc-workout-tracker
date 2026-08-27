import { describe, expect, it } from 'vitest'

import { overshootPreview } from './day-editor'
import type { DraftProgramExercise, DraftProgramSet } from './program-draft'

/** A draft set carrying a load and reps, for overriding. */
function draftSet(overrides: Partial<DraftProgramSet> = {}): DraftProgramSet {
  return {
    id: crypto.randomUUID(),
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: '5',
    repMax: '5',
    load: '100',
    rpe: '',
    rir: null,
    restSec: '',
    duration: '',
    distance: '',
    tempo: null,
    technique: null,
    ...overrides,
  } as DraftProgramSet
}

function exercise(sets: DraftProgramSet[]): DraftProgramExercise {
  return {
    id: 'ex1',
    wgerExerciseId: 1,
    source: 'wger',
    name: 'Back Squat',
    category: '',
    progression: null,
    trainingMax: '',
    trainingMaxFromE1rm: false,
    supersetGroup: null,
    overshootPolicy: null,
    sets,
  }
}

describe('overshootPreview', () => {
  it('picks the heaviest loaded set, not the first', () => {
    const preview = overshootPreview(
      exercise([draftSet({ load: '80' }), draftSet({ load: '120' }), draftSet({ load: '95' })]),
      'kg',
    )
    expect(preview).toEqual({ reps: '5', load: '120 kg' })
  })

  it('ignores half-typed loads rather than letting NaN decide the winner', () => {
    // Number('abc') is NaN and every NaN comparison is false, so an unguarded
    // reduce keeps whichever row came first — a partially typed row could
    // silently become "the heaviest".
    const preview = overshootPreview(
      exercise([draftSet({ load: 'abc' }), draftSet({ load: '60' })]),
      'kg',
    )
    expect(preview).toEqual({ reps: '5', load: '60 kg' })
  })

  it('returns null when nothing carries a load yet', () => {
    // The sheet then shows its options without inventing an example.
    expect(overshootPreview(exercise([draftSet({ load: '' })]), 'kg')).toBeNull()
    expect(overshootPreview(exercise([]), 'kg')).toBeNull()
  })

  it('returns null when the heaviest set has no reps to state', () => {
    expect(overshootPreview(exercise([draftSet({ load: '100', repMin: '' })]), 'kg')).toBeNull()
  })

  it('collapses an equal rep range and keeps a real one', () => {
    expect(overshootPreview(exercise([draftSet({ repMin: '8', repMax: '8' })]), 'kg')?.reps).toBe(
      '8',
    )
    expect(overshootPreview(exercise([draftSet({ repMin: '8', repMax: '12' })]), 'kg')?.reps).toBe(
      '8–12',
    )
    // A missing upper bound is a single number, not a dangling range.
    expect(overshootPreview(exercise([draftSet({ repMin: '6', repMax: '' })]), 'kg')?.reps).toBe('6')
  })

  it('formats the load through Intl, not by concatenation', () => {
    const expected = new Intl.NumberFormat('en', {
      style: 'unit',
      unit: 'pound',
      unitDisplay: 'short',
    }).format(225)
    expect(overshootPreview(exercise([draftSet({ load: '225' })]), 'lb', 'en')?.load).toBe(expected)
  })
})
