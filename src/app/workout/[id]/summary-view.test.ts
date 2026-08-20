import { describe, it, expect } from 'vitest'
import {
  compareExercises,
  durationVsLastLabel,
  e1rmDeltaDisplay,
  e1rmDirectionSuffix,
  finishHeadline,
  prHighlights,
  volumeVsLastLabel,
  type FinishHeadline,
  type SummaryExerciseInput,
} from './summary-view'
import { createTranslator } from 'next-intl'
import messages from '../../../../messages/en.json'

function exercise(over: Partial<SummaryExerciseInput> = {}): SummaryExerciseInput {
  return {
    id: 'card-1',
    wgerExerciseId: 73,
    source: 'wger',
    name: 'Bench Press',
    loggingType: 'weight_reps',
    sets: [],
    ...over,
  }
}

describe('compareExercises', () => {
  it('flags an e1rm PR and keeps both endpoints', () => {
    const result = compareExercises(
      [exercise({ sets: [{ reps: 5, weight: 100 }] })],
      [{ wgerExerciseId: 73, source: 'wger', reps: 5, weight: 90 }],
      null,
    )

    expect(result).toHaveLength(1)
    expect(result[0].isPr).toBe(true)
    expect(result[0].current?.kind).toBe('e1rm')
    expect(result[0].prior?.kind).toBe('e1rm')
  })

  it('judges a duplicated exercise by its best set across cards, badge on the first', () => {
    const result = compareExercises(
      [
        exercise({ id: 'card-a', sets: [{ reps: 5, weight: 80 }] }),
        exercise({ id: 'card-b', sets: [{ reps: 5, weight: 100 }] }),
      ],
      [{ wgerExerciseId: 73, source: 'wger', reps: 5, weight: 90 }],
      null,
    )

    expect(result).toHaveLength(1)
    expect(result[0].firstCardId).toBe('card-a')
    expect(result[0].isPr).toBe(true)
  })

  it('never merges a custom exercise with a colliding wger id', () => {
    const result = compareExercises(
      [
        exercise({ id: 'card-a', sets: [{ reps: 5, weight: 100 }] }),
        exercise({
          id: 'card-b',
          source: 'custom',
          name: 'My Bench',
          sets: [{ reps: 5, weight: 60 }],
        }),
      ],
      [{ wgerExerciseId: 73, source: 'custom', reps: 5, weight: 50 }],
      null,
    )

    expect(result.map((c) => c.key)).toEqual(['wger:73', 'custom:73'])
    expect(result[0].prior).toBeNull() // wger history is empty
    expect(result[1].isPr).toBe(true) // custom beat its own history only
  })

  it('does not badge mixed comparison kinds', () => {
    // Current session is rep-fallback (no weight); history was loaded.
    const result = compareExercises(
      [exercise({ sets: [{ reps: 12, weight: null }] })],
      [{ wgerExerciseId: 73, source: 'wger', reps: 5, weight: 90 }],
      null,
    )

    expect(result[0].current?.kind).toBe('reps')
    expect(result[0].prior?.kind).toBe('e1rm')
    expect(result[0].isPr).toBe(false)
  })

  it('flags a rep PR when neither side is load-scorable', () => {
    const result = compareExercises(
      [exercise({ sets: [{ reps: 14, weight: null }] })],
      [{ wgerExerciseId: 73, source: 'wger', reps: 12, weight: null }],
      null,
    )

    expect(result[0].isPr).toBe(true)
  })
})

describe('prHighlights', () => {
  it('turns PR comparisons into named delta lines, in workout order', () => {
    const comparisons = compareExercises(
      [
        exercise({ id: 'a', sets: [{ reps: 5, weight: 100 }] }),
        exercise({
          id: 'b',
          wgerExerciseId: 105,
          name: 'Squat',
          sets: [{ reps: 5, weight: 140 }],
        }),
      ],
      [
        { wgerExerciseId: 73, source: 'wger', reps: 5, weight: 90 },
        { wgerExerciseId: 105, source: 'wger', reps: 5, weight: 130 },
      ],
      null,
    )

    const highlights = prHighlights(comparisons)

    expect(highlights.map((h) => h.name)).toEqual(['Bench Press', 'Squat'])
    expect(highlights[0]).toMatchObject({ kind: 'e1rm' })
    if (highlights[0].kind === 'e1rm') {
      // Epley: 100 × (1 + 5/30) − 90 × (1 + 5/30)
      expect(highlights[0].deltaKg).toBeCloseTo(10 * (1 + 5 / 30))
    }
  })

  it('emits a rep highlight for rep-kind PRs and skips non-PRs', () => {
    const comparisons = compareExercises(
      [
        exercise({ sets: [{ reps: 14, weight: null }] }),
        exercise({ id: 'b', wgerExerciseId: 99, name: 'Row', sets: [{ reps: 5, weight: 60 }] }),
      ],
      [
        { wgerExerciseId: 73, source: 'wger', reps: 12, weight: null },
        { wgerExerciseId: 99, source: 'wger', reps: 5, weight: 70 },
      ],
      null,
    )

    expect(prHighlights(comparisons)).toEqual([
      { name: 'Bench Press', kind: 'reps', reps: 14, deltaReps: 2 },
    ])
  })
})

describe('finishHeadline', () => {
  const base = { blockClosed: false, programWeek: null }
  // Resolved through the REAL catalog, not a stub: the function now returns a
  // message CHOICE, so the copy assertion has to travel the same path the
  // page does — a key the catalog never got must fail here.
  const t = createTranslator({ locale: 'en', messages, namespace: 'WorkoutDetail' })
  const copy = (headline: FinishHeadline) => t(`headline.${headline.key}`, headline.values)

  it('picks the PR-count message, worded small and numeric large', () => {
    expect(finishHeadline({ ...base, prNames: ['Bench', 'Squat'] })).toEqual({
      key: 'prs',
      values: { count: 2 },
    })
    expect(copy(finishHeadline({ ...base, prNames: ['Bench', 'Squat'] }))).toBe('Two PRs.')
    expect(copy(finishHeadline({ ...base, prNames: ['a', 'b', 'c', 'd', 'e'] }))).toBe('Five PRs.')
    expect(copy(finishHeadline({ ...base, prNames: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }))).toBe(
      '7 PRs.',
    )
  })

  it('names the exercise for a single PR', () => {
    expect(finishHeadline({ ...base, prNames: ['Bench Press'] })).toEqual({
      key: 'pr',
      values: { exercise: 'Bench Press' },
    })
    expect(copy(finishHeadline({ ...base, prNames: ['Bench Press'] }))).toBe('Bench Press PR.')
  })

  it('celebrates a block-closing week when there are no PRs', () => {
    const headline = finishHeadline({ prNames: [], blockClosed: true, programWeek: 7 })
    expect(headline).toEqual({ key: 'blockClosed', values: { week: 7 } })
    expect(copy(headline)).toBe('Week 7 closed.')
  })

  it('lets PRs outrank the block close', () => {
    expect(
      copy(finishHeadline({ prNames: ['Bench'], blockClosed: true, programWeek: 7 })),
    ).toBe('Bench PR.')
  })

  it('falls back to the generic stamp (block close without a stamped week too)', () => {
    expect(copy(finishHeadline({ ...base, prNames: [] }))).toBe('Workout complete.')
    expect(
      copy(finishHeadline({ prNames: [], blockClosed: true, programWeek: null })),
    ).toBe('Workout complete.')
  })
})

describe('e1rmDirectionSuffix', () => {
  it('points up and down in the display unit', () => {
    expect(e1rmDirectionSuffix(2.27, 'lb')).toBe('↑ +5')
    expect(e1rmDirectionSuffix(-3, 'kg')).toBe('↓ −3')
  })

  it('is null when rounding erases the movement', () => {
    expect(e1rmDirectionSuffix(0, 'kg')).toBeNull()
    expect(e1rmDirectionSuffix(0.01, 'lb')).toBeNull()
  })
})

describe('volumeVsLastLabel', () => {
  it('signs the rounded display-unit delta with grouping', () => {
    expect(volumeVsLastLabel(5200, 4000, 'kg')).toBe('+1,200 kg')
    expect(volumeVsLastLabel(4000, 5200, 'kg')).toBe('−1,200 kg')
  })

  it('is null when flat after rounding', () => {
    expect(volumeVsLastLabel(1000, 1000.4, 'kg')).toBeNull()
  })
})

describe('durationVsLastLabel', () => {
  it('signs the minute delta', () => {
    expect(durationVsLastLabel(48, 42)).toBe('+6 min')
    expect(durationVsLastLabel(40, 45)).toBe('−5 min')
  })

  it('is null without both plausible durations or when flat', () => {
    expect(durationVsLastLabel(null, 42)).toBeNull()
    expect(durationVsLastLabel(42, null)).toBeNull()
    expect(durationVsLastLabel(42, 42)).toBeNull()
  })
})

describe('e1rmDeltaDisplay', () => {
  it('rounds Epley decimals to 1dp in kg (identity would leak precision)', () => {
    expect(e1rmDeltaDisplay(10 * (1 + 5 / 30), 'kg')).toBe(11.7)
    expect(e1rmDeltaDisplay(-3.33, 'kg')).toBe(3.3)
  })
})
