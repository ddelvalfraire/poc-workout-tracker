import { describe, it, expect } from 'vitest'
import { parseCustomExerciseInput, EXERCISE_CATEGORIES } from './custom-exercise-input'

describe('parseCustomExerciseInput', () => {
  it('parses a full input and trims the name', () => {
    const parsed = parseCustomExerciseInput({
      name: '  Nordic Curl  ',
      category: 'Legs',
      equipment: ['none (bodyweight exercise)'],
      muscles: ['Hamstrings'],
      musclesSecondary: ['Glutes'],
    })

    expect(parsed).toEqual({
      name: 'Nordic Curl',
      category: 'Legs',
      equipment: ['none (bodyweight exercise)'],
      muscles: ['Hamstrings'],
      musclesSecondary: ['Glutes'],
    })
  })

  it('parses a minimal input (name + category only, optionals undefined)', () => {
    const parsed = parseCustomExerciseInput({ name: 'Copenhagen Plank', category: 'Abs' })

    expect(parsed.name).toBe('Copenhagen Plank')
    expect(parsed.category).toBe('Abs')
    expect(parsed.equipment).toBeUndefined()
    expect(parsed.muscles).toBeUndefined()
    expect(parsed.musclesSecondary).toBeUndefined()
  })

  it('accepts every wger category', () => {
    for (const category of EXERCISE_CATEGORIES) {
      expect(() => parseCustomExerciseInput({ name: 'X', category })).not.toThrow()
    }
  })

  it('rejects an empty (whitespace-only) name', () => {
    expect(() => parseCustomExerciseInput({ name: '   ', category: 'Legs' })).toThrow()
  })

  it('rejects a name over 200 characters', () => {
    expect(() =>
      parseCustomExerciseInput({ name: 'x'.repeat(201), category: 'Legs' }),
    ).toThrow()
  })

  it('rejects a category outside the wger set', () => {
    expect(() => parseCustomExerciseInput({ name: 'Hip Thrust', category: 'Glutes' })).toThrow()
  })

  it('rejects a lowercase category (case-sensitive exact match)', () => {
    expect(() => parseCustomExerciseInput({ name: 'Bench Press', category: 'chest' })).toThrow()
  })

  it('rejects non-array muscles', () => {
    expect(() =>
      parseCustomExerciseInput({ name: 'Row', category: 'Back', muscles: 'Lats' }),
    ).toThrow()
  })

  it('rejects unknown keys (strict)', () => {
    expect(() =>
      parseCustomExerciseInput({ name: 'Row', category: 'Back', musclesPrimary: ['Lats'] }),
    ).toThrow()
  })
})
