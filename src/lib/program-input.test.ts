import { describe, it, expect } from 'vitest'
import {
  parseProgramInput,
  programSetIntegrityViolation,
  progressionSchema,
  setOverrideSchema,
} from './program-input'

/** A minimal valid program: one day, one exercise, one bare set. */
const VALID = {
  name: 'PPL',
  days: [{ name: 'Push', exercises: [{ wgerExerciseId: 73, name: 'Bench', sets: [{}] }] }],
}

describe('parseProgramInput', () => {
  it('accepts a minimal valid program and applies defaults', () => {
    // Act
    const result = parseProgramInput(VALID)

    // Assert — program- and set-level defaults filled in
    expect(result).toMatchObject({
      name: 'PPL',
      status: 'draft',
      mesocycleWeeks: 1,
      days: [
        {
          name: 'Push',
          exercises: [
            {
              wgerExerciseId: 73,
              name: 'Bench',
              sets: [{ setType: 'working', metricMode: 'reps_weight' }],
            },
          ],
        },
      ],
    })
  })

  it('keeps provided status and mesocycleWeeks', () => {
    // Act
    const result = parseProgramInput({ ...VALID, status: 'active', mesocycleWeeks: 6 })

    // Assert
    expect(result.status).toBe('active')
    expect(result.mesocycleWeeks).toBe(6)
  })

  it('trims program, day, and exercise names', () => {
    // Act
    const result = parseProgramInput({
      name: '  PPL  ',
      days: [{ name: '  Push  ', exercises: [{ wgerExerciseId: 1, name: '  Bench  ', sets: [{}] }] }],
    })

    // Assert
    expect(result.name).toBe('PPL')
    expect(result.days[0].name).toBe('Push')
    expect(result.days[0].exercises[0].name).toBe('Bench')
  })

  it('keeps typed per-set targets (rep range, RIR, suggested load)', () => {
    // Act
    const result = parseProgramInput({
      name: 'P',
      days: [
        {
          name: 'Push',
          exercises: [
            {
              wgerExerciseId: 1,
              name: 'Bench',
              sets: [{ setType: 'working', repMin: 8, repMax: 12, rir: 2, suggestedLoadKg: 60 }],
            },
          ],
        },
      ],
    })

    // Assert
    expect(result.days[0].exercises[0].sets[0]).toMatchObject({
      setType: 'working',
      repMin: 8,
      repMax: 12,
      rir: 2,
      suggestedLoadKg: 60,
    })
  })

  it('accepts a valid drop-set technique and defaults its version', () => {
    // Act
    const result = parseProgramInput({
      name: 'P',
      days: [
        {
          name: 'Arms',
          exercises: [
            {
              wgerExerciseId: 1,
              name: 'Curl',
              sets: [{ technique: { kind: 'drop-set', stages: [{ loadKg: 20, reps: 10 }] } }],
            },
          ],
        },
      ],
    })

    // Assert — version filled in
    expect(result.days[0].exercises[0].sets[0].technique).toMatchObject({
      version: 1,
      kind: 'drop-set',
      stages: [{ loadKg: 20, reps: 10 }],
    })
  })

  it('accepts a valid linear progression on an exercise', () => {
    // Act
    const result = parseProgramInput({
      name: 'P',
      days: [
        {
          name: 'Push',
          exercises: [
            {
              wgerExerciseId: 1,
              name: 'Bench',
              progression: { scheme: 'linear', incrementKg: 2.5 },
              sets: [{}],
            },
          ],
        },
      ],
    })

    // Assert
    expect(result.days[0].exercises[0].progression).toEqual({ scheme: 'linear', incrementKg: 2.5 })
  })

  it('accepts a timed set with a planned duration', () => {
    // Act
    const result = parseProgramInput({
      name: 'Core',
      days: [
        {
          name: 'Abs',
          exercises: [
            { wgerExerciseId: 9, name: 'Plank', sets: [{ metricMode: 'duration', durationSec: 60 }] },
          ],
        },
      ],
    })

    // Assert
    expect(result.days[0].exercises[0].sets[0]).toMatchObject({ metricMode: 'duration', durationSec: 60 })
  })

  it('does not mutate the input', () => {
    // Arrange
    const input = { name: '  PPL  ', days: [{ name: ' Push ', exercises: [{ wgerExerciseId: 1, name: ' x ', sets: [{}] }] }] }

    // Act
    parseProgramInput(input)

    // Assert — original untouched
    expect(input.name).toBe('  PPL  ')
    expect(input.days[0].name).toBe(' Push ')
  })

  it.each([
    ['a non-object', 'not-an-object'],
    ['null', null],
    ['missing days', { name: 'x' }],
    ['empty days', { name: 'x', days: [] }],
  ])('throws when input is %s', (_label, input) => {
    expect(() => parseProgramInput(input)).toThrow()
  })

  it('throws when a day has no exercises', () => {
    expect(() => parseProgramInput({ name: 'x', days: [{ name: 'Push', exercises: [] }] })).toThrow()
  })

  it('throws when an exercise has no sets', () => {
    expect(() =>
      parseProgramInput({
        name: 'x',
        days: [{ name: 'Push', exercises: [{ wgerExerciseId: 1, name: 'Bench', sets: [] }] }],
      }),
    ).toThrow()
  })

  it('throws when wgerExerciseId is not an integer', () => {
    expect(() =>
      parseProgramInput({
        name: 'x',
        days: [{ name: 'Push', exercises: [{ wgerExerciseId: 'x', name: 'Bench', sets: [{}] }] }],
      }),
    ).toThrow()
  })

  it('throws when an exercise name is blank', () => {
    expect(() =>
      parseProgramInput({
        name: 'x',
        days: [{ name: 'Push', exercises: [{ wgerExerciseId: 1, name: '   ', sets: [{}] }] }],
      }),
    ).toThrow()
  })

  it('throws on an unknown metricMode', () => {
    expect(() =>
      parseProgramInput({
        name: 'x',
        days: [{ name: 'Push', exercises: [{ wgerExerciseId: 1, name: 'Bench', sets: [{ metricMode: 'tempo' }] }] }],
      }),
    ).toThrow()
  })

  it('throws when a timed set is missing durationSec', () => {
    expect(() =>
      parseProgramInput({
        name: 'x',
        days: [{ name: 'Abs', exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [{ metricMode: 'duration' }] }] }],
      }),
    ).toThrow(/durationSec/i)
  })

  it('throws when repMin exceeds repMax', () => {
    expect(() =>
      parseProgramInput({
        name: 'x',
        days: [{ name: 'Push', exercises: [{ wgerExerciseId: 1, name: 'Bench', sets: [{ repMin: 12, repMax: 8 }] }] }],
      }),
    ).toThrow(/repMin/i)
  })

  it('throws when suggestedLoadKg exceeds the numeric(6,2) ceiling', () => {
    expect(() =>
      parseProgramInput({
        name: 'x',
        days: [{ name: 'Push', exercises: [{ wgerExerciseId: 1, name: 'Bench', sets: [{ suggestedLoadKg: 10_000 }] }] }],
      }),
    ).toThrow()
  })

  it('throws on an unknown technique kind', () => {
    expect(() =>
      parseProgramInput({
        name: 'x',
        days: [
          {
            name: 'Arms',
            exercises: [
              { wgerExerciseId: 1, name: 'Curl', sets: [{ technique: { kind: 'giant-set', stages: [{}] } }] },
            ],
          },
        ],
      }),
    ).toThrow()
  })

  it('accepts a deloadWeek within the mesocycle', () => {
    const result = parseProgramInput({ ...VALID, mesocycleWeeks: 4, deloadWeek: 4 })
    expect(result.deloadWeek).toBe(4)
  })

  it('throws when deloadWeek exceeds mesocycleWeeks', () => {
    expect(() => parseProgramInput({ ...VALID, mesocycleWeeks: 4, deloadWeek: 5 })).toThrow(
      /deloadWeek/i,
    )
  })

  it('throws on an unknown progression scheme', () => {
    expect(() =>
      parseProgramInput({
        name: 'x',
        days: [
          {
            name: 'Push',
            exercises: [
              { wgerExerciseId: 1, name: 'Bench', progression: { scheme: 'magic' }, sets: [{}] },
            ],
          },
        ],
      }),
    ).toThrow()
  })
})

describe('programSetIntegrityViolation', () => {
  // The single source of the cross-field set rules — the schema refines and the
  // patch layer's merge revalidation must both flag exactly these shapes.

  it('flags a timed set without a planned duration', () => {
    // Arrange
    const row = { metricMode: 'duration', durationSec: null, repMin: null, repMax: null }

    // Act
    const violation = programSetIntegrityViolation(row)

    // Assert
    expect(violation).toEqual({
      path: 'durationSec',
      message: 'durationSec is required when metricMode is duration or duration_distance',
    })
  })

  it('flags duration_distance without a planned duration', () => {
    const violation = programSetIntegrityViolation({
      metricMode: 'duration_distance',
      durationSec: null,
      repMin: null,
      repMax: null,
    })
    expect(violation?.path).toBe('durationSec')
  })

  it('accepts a reps_weight set without a duration', () => {
    expect(
      programSetIntegrityViolation({
        metricMode: 'reps_weight',
        durationSec: null,
        repMin: 5,
        repMax: 8,
      }),
    ).toBeNull()
  })

  it('flags an inverted rep range', () => {
    // Arrange
    const row = { metricMode: 'reps_weight', durationSec: null, repMin: 10, repMax: 5 }

    // Act
    const violation = programSetIntegrityViolation(row)

    // Assert
    expect(violation).toEqual({
      path: 'repMin',
      message: 'repMin must be less than or equal to repMax',
    })
  })

  it('accepts a half-open rep range (only one bound set)', () => {
    expect(
      programSetIntegrityViolation({
        metricMode: 'reps_weight',
        durationSec: null,
        repMin: 10,
        repMax: null,
      }),
    ).toBeNull()
  })

  it('backs the schema refines — parse rejects the same shapes with the same messages', () => {
    const withSets = (sets: unknown[]) => ({
      name: 'x',
      days: [{ name: 'Push', exercises: [{ wgerExerciseId: 1, name: 'Bench', sets }] }],
    })
    expect(() => parseProgramInput(withSets([{ metricMode: 'duration' }]))).toThrow(
      /durationSec is required/,
    )
    expect(() => parseProgramInput(withSets([{ repMin: 10, repMax: 5 }]))).toThrow(
      /repMin must be less than or equal to repMax/,
    )
  })
})

describe('progressionSchema bounds (Phase 5 tightening)', () => {
  it('accepts every scheme with sane params (regression)', () => {
    const valid = [
      { scheme: 'linear', incrementKg: 2.5 },
      { scheme: 'double-progression', repMin: 8, repMax: 12, incrementKg: 2.5 },
      { scheme: 'percent-1rm', trainingMaxKg: 200, weekPercents: [0.7, 0.75, 0.8] },
      { scheme: 'rpe-target', targetRpe: 8 },
      { scheme: 'weekly-volume', mevSets: 8, mrvSets: 14 },
    ]
    for (const p of valid) expect(() => progressionSchema.parse(p)).not.toThrow()
  })

  it('rejects out-of-bound params per scheme', () => {
    const invalid = [
      { scheme: 'linear', incrementKg: -1 },
      { scheme: 'percent-1rm', trainingMaxKg: -5, weekPercents: [0.7] },
      { scheme: 'percent-1rm', trainingMaxKg: 200, weekPercents: [] },
      { scheme: 'percent-1rm', trainingMaxKg: 200, weekPercents: [2.5] },
      { scheme: 'rpe-target', targetRpe: 11 },
      { scheme: 'weekly-volume', mevSets: -1, mrvSets: 10 },
    ]
    for (const p of invalid) expect(() => progressionSchema.parse(p), JSON.stringify(p)).toThrow()
  })

  it('rejects cross-field violations (repMin>repMax, mev>mrv)', () => {
    expect(() =>
      progressionSchema.parse({ scheme: 'double-progression', repMin: 12, repMax: 8, incrementKg: 2.5 }),
    ).toThrow(/repMin/)
    expect(() =>
      progressionSchema.parse({ scheme: 'weekly-volume', mevSets: 14, mrvSets: 8 }),
    ).toThrow(/mevSets/)
  })
})

describe('setOverrideSchema', () => {
  it('accepts a partial override of target fields', () => {
    expect(() =>
      setOverrideSchema.parse({ suggestedLoadKg: 95, repMin: 5, repMax: 5 }),
    ).not.toThrow()
  })

  it('rejects shape-changing fields (setType/metricMode are edits, not overrides)', () => {
    expect(() => setOverrideSchema.parse({ setType: 'amrap' })).toThrow()
    expect(() => setOverrideSchema.parse({ metricMode: 'duration' })).toThrow()
  })

  it('applies the same bounds as programSetSchema', () => {
    expect(() => setOverrideSchema.parse({ rpe: 11 })).toThrow()
    expect(() => setOverrideSchema.parse({ suggestedLoadKg: -1 })).toThrow()
  })
})
