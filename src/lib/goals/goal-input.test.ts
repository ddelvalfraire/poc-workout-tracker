import { describe, it, expect } from 'vitest'
import { parseGoalInput } from './goal-input'

const squat = { wgerExerciseId: 73, source: 'wger', name: 'Squat' }

describe('parseGoalInput — kinds', () => {
  it('rejects non-object input and unknown kinds', () => {
    expect(() => parseGoalInput(null)).toThrow('invalid goal input')
    expect(() => parseGoalInput('strength')).toThrow('invalid goal input')
    expect(() => parseGoalInput({ kind: 'cardio', target: {} })).toThrow(
      "goal kind must be 'strength', 'bodyweight' or 'consistency'",
    )
    expect(() => parseGoalInput({ kind: 'strength', target: null })).toThrow('invalid goal target')
  })
})

describe('parseGoalInput — strength', () => {
  it('parses a valid strength goal, trimming the exercise name', () => {
    const parsed = parseGoalInput({
      kind: 'strength',
      target: { e1rmKg: 142.505 },
      exercise: { ...squat, name: '  Squat ' },
    })
    expect(parsed).toEqual({
      kind: 'strength',
      target: { e1rmKg: 142.51 }, // rounded to column precision
      exercise: squat,
      deadline: null,
    })
  })

  it('enforces the 1–1000 kg e1RM band', () => {
    expect(() =>
      parseGoalInput({ kind: 'strength', target: { e1rmKg: 0.5 }, exercise: squat }),
    ).toThrow('between 1 and 1000 kg')
    expect(() =>
      parseGoalInput({ kind: 'strength', target: { e1rmKg: 1001 }, exercise: squat }),
    ).toThrow('between 1 and 1000 kg')
    expect(() =>
      parseGoalInput({ kind: 'strength', target: { e1rmKg: NaN }, exercise: squat }),
    ).toThrow('must be a number')
  })

  it('requires a valid exercise ref (positive id, whitelisted source, non-empty name)', () => {
    expect(() => parseGoalInput({ kind: 'strength', target: { e1rmKg: 100 } })).toThrow(
      'a strength goal needs an exercise',
    )
    expect(() =>
      parseGoalInput({
        kind: 'strength',
        target: { e1rmKg: 100 },
        exercise: { ...squat, wgerExerciseId: -1 },
      }),
    ).toThrow('invalid exercise id')
    expect(() =>
      parseGoalInput({
        kind: 'strength',
        target: { e1rmKg: 100 },
        exercise: { ...squat, source: 'hevy' },
      }),
    ).toThrow("must be 'wger' or 'custom'")
    expect(() =>
      parseGoalInput({
        kind: 'strength',
        target: { e1rmKg: 100 },
        exercise: { ...squat, name: '  ' },
      }),
    ).toThrow('invalid exercise name')
  })
})

describe('parseGoalInput — bodyweight', () => {
  it('parses both directions and enforces the 20–500 kg band', () => {
    expect(
      parseGoalInput({ kind: 'bodyweight', target: { weightKg: 80, direction: 'down' } }),
    ).toEqual({ kind: 'bodyweight', target: { weightKg: 80, direction: 'down' }, deadline: null })
    expect(() =>
      parseGoalInput({ kind: 'bodyweight', target: { weightKg: 19.9, direction: 'up' } }),
    ).toThrow('between 20 and 500 kg')
    expect(() =>
      parseGoalInput({ kind: 'bodyweight', target: { weightKg: 501, direction: 'up' } }),
    ).toThrow('between 20 and 500 kg')
    expect(() =>
      parseGoalInput({ kind: 'bodyweight', target: { weightKg: 80, direction: 'sideways' } }),
    ).toThrow("direction must be 'down' or 'up'")
  })

  it('rejects an exercise ref on a non-strength goal', () => {
    expect(() =>
      parseGoalInput({
        kind: 'bodyweight',
        target: { weightKg: 80, direction: 'down' },
        exercise: squat,
      }),
    ).toThrow('must not carry an exercise')
  })
})

describe('parseGoalInput — consistency (streak grace)', () => {
  it('parses target weeks with an explicit grace', () => {
    expect(
      parseGoalInput({ kind: 'consistency', target: { targetWeeks: 8, allowedMissesPerWeek: 0 } }),
    ).toEqual({
      kind: 'consistency',
      target: { targetWeeks: 8, allowedMissesPerWeek: 0 },
      deadline: null,
    })
  })

  it('defaults grace to 1 miss per week when absent (forgiving default)', () => {
    const parsed = parseGoalInput({ kind: 'consistency', target: { targetWeeks: 12 } })
    expect(parsed.target).toEqual({ targetWeeks: 12, allowedMissesPerWeek: 1 })
  })

  it('rejects grace outside 0|1|2 and weeks outside 1–104', () => {
    expect(() =>
      parseGoalInput({ kind: 'consistency', target: { targetWeeks: 8, allowedMissesPerWeek: 3 } }),
    ).toThrow('allowed misses per week must be 0, 1 or 2')
    expect(() =>
      parseGoalInput({
        kind: 'consistency',
        target: { targetWeeks: 8, allowedMissesPerWeek: 1.5 },
      }),
    ).toThrow('allowed misses per week must be 0, 1 or 2')
    expect(() => parseGoalInput({ kind: 'consistency', target: { targetWeeks: 0 } })).toThrow(
      'between 1 and 104',
    )
    expect(() => parseGoalInput({ kind: 'consistency', target: { targetWeeks: 105 } })).toThrow(
      'between 1 and 104',
    )
    expect(() => parseGoalInput({ kind: 'consistency', target: { targetWeeks: 8.5 } })).toThrow(
      'between 1 and 104',
    )
  })
})

describe('parseGoalInput — deadline', () => {
  it('accepts a real calendar date, null, and absent; rejects junk', () => {
    expect(
      parseGoalInput({
        kind: 'consistency',
        target: { targetWeeks: 8 },
        deadline: '2026-11-12',
      }).deadline,
    ).toBe('2026-11-12')
    expect(
      parseGoalInput({ kind: 'consistency', target: { targetWeeks: 8 }, deadline: null }).deadline,
    ).toBe(null)
    expect(() =>
      parseGoalInput({ kind: 'consistency', target: { targetWeeks: 8 }, deadline: '12/11/2026' }),
    ).toThrow('YYYY-MM-DD')
    expect(() =>
      parseGoalInput({ kind: 'consistency', target: { targetWeeks: 8 }, deadline: '2026-02-31' }),
    ).toThrow('real calendar date')
  })
})
