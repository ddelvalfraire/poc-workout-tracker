import { describe, it, expect } from 'vitest'
import { parseWorkoutInput, type WorkoutInput } from './workout-input'

/** A minimal valid workout: one exercise, one fully-logged set. */
const VALID: WorkoutInput = {
  exercises: [{ wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 5, weight: 100 }] }],
}

describe('parseWorkoutInput', () => {
  it('accepts a minimal valid workout and returns a normalized object', () => {
    // Act
    const result = parseWorkoutInput(VALID)

    // Assert
    expect(result).toEqual(VALID)
  })

  it('keeps a provided, trimmed name', () => {
    // Act
    const result = parseWorkoutInput({ ...VALID, name: '  Leg Day  ' })

    // Assert
    expect(result.name).toBe('Leg Day')
  })

  it('omits a blank / whitespace-only name', () => {
    // Act
    const result = parseWorkoutInput({ ...VALID, name: '   ' })

    // Assert
    expect(result).not.toHaveProperty('name')
  })

  it('accepts null reps and weight', () => {
    // Act
    const result = parseWorkoutInput({
      exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [{ reps: null, weight: null }] }],
    })

    // Assert
    expect(result.exercises[0].sets[0]).toEqual({ reps: null, weight: null })
  })

  it('passes a boolean completed through and omits it when absent', () => {
    // Act
    const result = parseWorkoutInput({
      exercises: [
        {
          wgerExerciseId: 1,
          name: 'Bench',
          sets: [
            { reps: 5, weight: 100, completed: true },
            { reps: 5, weight: 100, completed: false },
            { reps: 5, weight: 100 },
          ],
        },
      ],
    })

    // Assert
    expect(result.exercises[0].sets[0]).toEqual({ reps: 5, weight: 100, completed: true })
    expect(result.exercises[0].sets[1]).toEqual({ reps: 5, weight: 100, completed: false })
    expect(result.exercises[0].sets[2]).not.toHaveProperty('completed')
  })

  it('throws when completed is not a boolean', () => {
    for (const completed of ['yes', 1, {}]) {
      expect(() =>
        parseWorkoutInput({
          exercises: [{ wgerExerciseId: 1, name: 'Bench', sets: [{ reps: 5, weight: 100, completed }] }],
        }),
      ).toThrow('set completed must be a boolean')
    }
  })

  it('trims the exercise name and drops extra keys', () => {
    // Act
    const result = parseWorkoutInput({
      exercises: [{ wgerExerciseId: 1, name: '  Bench  ', sets: [], extra: 'nope' }],
    })

    // Assert
    expect(result.exercises[0]).toEqual({ wgerExerciseId: 1, name: 'Bench', sets: [] })
  })

  it('does not mutate the input', () => {
    // Arrange
    const input = { name: '  Leg Day  ', exercises: [{ wgerExerciseId: 1, name: ' x ', sets: [] }] }

    // Act
    parseWorkoutInput(input)

    // Assert — original untouched
    expect(input.name).toBe('  Leg Day  ')
    expect(input.exercises[0].name).toBe(' x ')
  })

  it.each([
    ['a non-object', 'not-an-object'],
    ['null', null],
    ['missing exercises', { name: 'x' }],
    ['empty exercises', { exercises: [] }],
  ])('throws when input is %s', (_label, input) => {
    expect(() => parseWorkoutInput(input)).toThrow()
  })

  it('throws when exercises is empty', () => {
    expect(() => parseWorkoutInput({ exercises: [] })).toThrow(/at least one exercise/i)
  })

  it('throws when an exercise is missing wgerExerciseId', () => {
    expect(() => parseWorkoutInput({ exercises: [{ name: 'x', sets: [] }] })).toThrow(/wgerExerciseId/i)
  })

  it('throws when wgerExerciseId is not an integer', () => {
    expect(() =>
      parseWorkoutInput({ exercises: [{ wgerExerciseId: 'x', name: 'Squat', sets: [] }] }),
    ).toThrow(/wgerExerciseId/i)
  })

  it('throws when an exercise name is empty', () => {
    expect(() =>
      parseWorkoutInput({ exercises: [{ wgerExerciseId: 1, name: '   ', sets: [] }] }),
    ).toThrow(/name/i)
  })

  it('throws when reps is negative', () => {
    expect(() =>
      parseWorkoutInput({
        exercises: [{ wgerExerciseId: 1, name: 'Squat', sets: [{ reps: -1, weight: null }] }],
      }),
    ).toThrow(/reps/i)
  })

  it('throws when reps exceeds the max', () => {
    expect(() =>
      parseWorkoutInput({
        exercises: [{ wgerExerciseId: 1, name: 'Squat', sets: [{ reps: 10_001, weight: null }] }],
      }),
    ).toThrow(/reps/i)
  })

  it('throws when weight is non-finite', () => {
    expect(() =>
      parseWorkoutInput({
        exercises: [{ wgerExerciseId: 1, name: 'Squat', sets: [{ reps: 5, weight: Infinity }] }],
      }),
    ).toThrow(/weight/i)
  })

  it('throws when weight exceeds the numeric(6,2) column ceiling', () => {
    expect(() =>
      parseWorkoutInput({
        exercises: [{ wgerExerciseId: 1, name: 'Squat', sets: [{ reps: 5, weight: 10_000 }] }],
      }),
    ).toThrow(/weight/i)
  })

  describe('loggingType', () => {
    it('omits loggingType when absent (legacy payloads default at the column)', () => {
      // Act
      const result = parseWorkoutInput(VALID)

      // Assert
      expect(result.exercises[0]).not.toHaveProperty('loggingType')
    })

    it.each(['weight_reps', 'bodyweight_reps', 'weighted_bodyweight', 'assisted_bodyweight'])(
      'keeps a whitelisted loggingType (%s)',
      (loggingType) => {
        // Act
        const result = parseWorkoutInput({
          exercises: [{ wgerExerciseId: 1, name: 'Pull-up', loggingType, sets: [] }],
        })

        // Assert
        expect(result.exercises[0].loggingType).toBe(loggingType)
      },
    )

    it('throws for a non-whitelisted loggingType', () => {
      expect(() =>
        parseWorkoutInput({
          exercises: [{ wgerExerciseId: 1, name: 'Pull-up', loggingType: 'machine', sets: [] }],
        }),
      ).toThrow(/loggingType must be one of/i)
    })

    it('throws for a non-string loggingType', () => {
      expect(() =>
        parseWorkoutInput({
          exercises: [{ wgerExerciseId: 1, name: 'Pull-up', loggingType: 3, sets: [] }],
        }),
      ).toThrow(/loggingType/i)
    })
  })

  describe('exercise source', () => {
    it('passes through a whitelisted source and omits an absent one', () => {
      const result = parseWorkoutInput({
        exercises: [
          { wgerExerciseId: 1, source: 'custom', name: 'My Row', sets: [] },
          { wgerExerciseId: 1, name: 'Squat', sets: [] },
        ],
      })

      expect(result.exercises[0].source).toBe('custom')
      // Absent stays absent — the column default ('wger') applies at insert.
      expect('source' in result.exercises[1]).toBe(false)
    })

    it('throws for a non-whitelisted source', () => {
      expect(() =>
        parseWorkoutInput({
          exercises: [{ wgerExerciseId: 1, source: 'homemade', name: 'X', sets: [] }],
        }),
      ).toThrow(/source must be 'wger' or 'custom'/i)
    })
  })

  it('throws when a set is not an object', () => {
    expect(() =>
      parseWorkoutInput({ exercises: [{ wgerExerciseId: 1, name: 'Squat', sets: ['bad'] }] }),
    ).toThrow(/set/i)
  })

  describe('startedAt', () => {
    it('omits startedAt when absent', () => {
      // Act
      const result = parseWorkoutInput(VALID)

      // Assert
      expect(result).not.toHaveProperty('startedAt')
    })

    it('keeps a past ISO date string as a Date', () => {
      // Act
      const result = parseWorkoutInput({ ...VALID, startedAt: '2026-01-02T00:00:00.000Z' })

      // Assert
      expect(result.startedAt).toBeInstanceOf(Date)
      expect(result.startedAt?.toISOString()).toBe('2026-01-02T00:00:00.000Z')
    })

    it('accepts a Date instance', () => {
      // Arrange
      const when = new Date('2025-12-25T12:00:00.000Z')

      // Act
      const result = parseWorkoutInput({ ...VALID, startedAt: when })

      // Assert
      expect(result.startedAt?.getTime()).toBe(when.getTime())
    })

    it('throws for a future date', () => {
      // Arrange — one day ahead of now
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      // Act + Assert
      expect(() => parseWorkoutInput({ ...VALID, startedAt: future })).toThrow(/future/i)
    })

    it('throws for an unparseable date string', () => {
      expect(() => parseWorkoutInput({ ...VALID, startedAt: 'not-a-date' })).toThrow(/date/i)
    })

    it('omits a blank startedAt string', () => {
      // Act
      const result = parseWorkoutInput({ ...VALID, startedAt: '   ' })

      // Assert
      expect(result).not.toHaveProperty('startedAt')
    })
  })

  describe('completedAt', () => {
    it('omits completedAt when absent', () => {
      // Act
      const result = parseWorkoutInput(VALID)

      // Assert
      expect(result).not.toHaveProperty('completedAt')
    })

    it('keeps a past ISO date string as a Date', () => {
      // Act
      const result = parseWorkoutInput({ ...VALID, completedAt: '2026-01-02T00:45:00.000Z' })

      // Assert
      expect(result.completedAt).toBeInstanceOf(Date)
      expect(result.completedAt?.toISOString()).toBe('2026-01-02T00:45:00.000Z')
    })

    it('throws for a future date', () => {
      // Arrange — one day ahead of now
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      // Act + Assert
      expect(() => parseWorkoutInput({ ...VALID, completedAt: future })).toThrow(/future/i)
    })

    it('throws for an unparseable date string', () => {
      expect(() => parseWorkoutInput({ ...VALID, completedAt: 'not-a-date' })).toThrow(/date/i)
    })

    it('throws when completedAt is before startedAt', () => {
      expect(() =>
        parseWorkoutInput({
          ...VALID,
          startedAt: '2026-01-02T10:00:00.000Z',
          completedAt: '2026-01-02T09:00:00.000Z',
        }),
      ).toThrow(/before/i)
    })

    it('accepts completedAt equal to startedAt (instant backdated log)', () => {
      // Act
      const result = parseWorkoutInput({
        ...VALID,
        startedAt: '2026-01-02T10:00:00.000Z',
        completedAt: '2026-01-02T10:00:00.000Z',
      })

      // Assert
      expect(result.completedAt?.toISOString()).toBe('2026-01-02T10:00:00.000Z')
    })
  })
})
