import { describe, it, expect } from 'vitest'
import { parseTemplateInput, parseTemplateMeta } from './template-input'

/** A valid baseline payload; tests spread mutations over it. */
const VALID = {
  name: 'Push Day',
  description: 'Chest and shoulders',
  icon: '💪',
  exercises: [
    {
      wgerExerciseId: 73,
      source: 'wger',
      name: 'Bench Press',
      loggingType: 'weight_reps',
      notes: 'touch and go',
      plannedSets: 3,
      repMin: 8,
      repMax: 12,
      restSec: 90,
    },
  ],
}

describe('parseTemplateInput', () => {
  it('accepts a full valid payload, returning a fresh normalized object', () => {
    // Act
    const parsed = parseTemplateInput(VALID)

    // Assert — normalized copy, not the same reference
    expect(parsed).not.toBe(VALID)
    expect(parsed).toEqual(VALID)
  })

  it('accepts a minimal payload, omitting absent optionals', () => {
    // Act
    const parsed = parseTemplateInput({
      name: '  Pull Day  ',
      exercises: [{ wgerExerciseId: 9, name: 'Row', plannedSets: 1 }],
    })

    // Assert — trimmed name; no optional keys invented
    expect(parsed).toEqual({
      name: 'Pull Day',
      exercises: [{ wgerExerciseId: 9, name: 'Row', plannedSets: 1 }],
    })
  })

  it('requires a non-empty name within 200 characters', () => {
    expect(() => parseTemplateInput({ ...VALID, name: '   ' })).toThrow(/name/)
    expect(() => parseTemplateInput({ ...VALID, name: 42 })).toThrow(/name/)
    expect(() => parseTemplateInput({ ...VALID, name: 'x'.repeat(201) })).toThrow(/200/)
  })

  it('rejects an over-long description and icon (reject, never truncate)', () => {
    expect(() => parseTemplateInput({ ...VALID, description: 'x'.repeat(2001) })).toThrow(/2000/)
    expect(() => parseTemplateInput({ ...VALID, icon: 'x'.repeat(17) })).toThrow(/16/)
  })

  it('requires at least one exercise', () => {
    expect(() => parseTemplateInput({ ...VALID, exercises: [] })).toThrow(/at least one/)
    expect(() => parseTemplateInput({ ...VALID, exercises: 'nope' })).toThrow(/at least one/)
  })

  it('rejects non-positive or non-integer exercise ids', () => {
    const withId = (wgerExerciseId: unknown) => ({
      ...VALID,
      exercises: [{ ...VALID.exercises[0], wgerExerciseId }],
    })
    expect(() => parseTemplateInput(withId(0))).toThrow(/positive integer/)
    expect(() => parseTemplateInput(withId(-73))).toThrow(/positive integer/)
    expect(() => parseTemplateInput(withId(7.5))).toThrow(/positive integer/)
  })

  it('whitelists source and loggingType', () => {
    const withField = (field: string, value: unknown) => ({
      ...VALID,
      exercises: [{ ...VALID.exercises[0], [field]: value }],
    })
    expect(() => parseTemplateInput(withField('source', 'hevy'))).toThrow(/source/)
    expect(() => parseTemplateInput(withField('loggingType', 'barbell'))).toThrow(/loggingType/)
    // null → column default, accepted and omitted
    expect(
      parseTemplateInput(withField('source', null)).exercises[0],
    ).not.toHaveProperty('source')
  })

  it('bounds plannedSets to 1–10', () => {
    const withSets = (plannedSets: unknown) => ({
      ...VALID,
      exercises: [{ ...VALID.exercises[0], plannedSets }],
    })
    expect(() => parseTemplateInput(withSets(0))).toThrow(/between 1 and 10/)
    expect(() => parseTemplateInput(withSets(11))).toThrow(/between 1 and 10/)
    expect(() => parseTemplateInput(withSets(undefined))).toThrow(/between 1 and 10/)
    expect(parseTemplateInput(withSets(10)).exercises[0].plannedSets).toBe(10)
  })

  it('bounds reps to 1–100 and enforces repMin ≤ repMax', () => {
    const withReps = (repMin: unknown, repMax: unknown) => ({
      ...VALID,
      exercises: [{ ...VALID.exercises[0], repMin, repMax }],
    })
    expect(() => parseTemplateInput(withReps(0, 5))).toThrow(/between 1 and 100/)
    expect(() => parseTemplateInput(withReps(5, 101))).toThrow(/between 1 and 100/)
    expect(() => parseTemplateInput(withReps(12, 8))).toThrow(/repMin must not exceed repMax/)
    expect(parseTemplateInput(withReps(8, 8)).exercises[0]).toMatchObject({ repMin: 8, repMax: 8 })
  })

  it('bounds restSec to 0–600', () => {
    const withRest = (restSec: unknown) => ({
      ...VALID,
      exercises: [{ ...VALID.exercises[0], restSec }],
    })
    expect(() => parseTemplateInput(withRest(-1))).toThrow(/between 0 and 600/)
    expect(() => parseTemplateInput(withRest(601))).toThrow(/between 0 and 600/)
    expect(parseTemplateInput(withRest(0)).exercises[0].restSec).toBe(0)
  })

  it('caps the exercise list to keep hostile payloads out of the row', () => {
    const many = Array.from({ length: 31 }, (_, i) => ({
      wgerExerciseId: i + 1,
      name: `Exercise ${i}`,
      plannedSets: 3,
    }))
    expect(() => parseTemplateInput({ ...VALID, exercises: many })).toThrow(/at most 30/)
  })
})

describe('parseTemplateMeta', () => {
  it('accepts name-only meta, dropping blank optionals', () => {
    // Act
    const parsed = parseTemplateMeta({ name: 'Legs', description: '  ', icon: '' })

    // Assert — blanks omitted so the DB layer clears them to null
    expect(parsed).toEqual({ name: 'Legs' })
  })

  it('applies the same name/description/icon rules as the full input', () => {
    expect(() => parseTemplateMeta({ name: '' })).toThrow(/name/)
    expect(() => parseTemplateMeta({ name: 'ok', description: 'x'.repeat(2001) })).toThrow(/2000/)
    expect(() => parseTemplateMeta({ name: 'ok', icon: 'x'.repeat(17) })).toThrow(/16/)
    expect(parseTemplateMeta({ name: 'ok', icon: '🏋️' })).toEqual({ name: 'ok', icon: '🏋️' })
  })
})
