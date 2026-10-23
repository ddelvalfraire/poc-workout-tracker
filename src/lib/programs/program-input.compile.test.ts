import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { parseProgramInput, programInputSchema } from './program-input'
import { ZodError } from 'zod'

const minimal = {
  name: '  Trial ',
  days: [{ name: ' Day ', exercises: [{ wgerExerciseId: 73, name: ' Squat ', sets: [{}] }] }],
}

function boundaryResult(input: unknown) {
  try {
    return { success: true, data: parseProgramInput(input) }
  } catch (error) {
    if (!(error instanceof ZodError)) throw error
    return { success: false, issues: error.issues }
  }
}

function referenceResult(input: unknown) {
  const result = programInputSchema.safeParse(input)
  return result.success
    ? { success: true, data: result.data }
    : { success: false, issues: result.error.issues }
}

describe('compiled program boundary preserves the schema contract', () => {
  it.each([
    minimal,
    { ...minimal, notes: null, autoregulation: false, description: '  ', sourceUrl: '' },
    { ...minimal, mesocycleWeeks: 2, deloadWeek: 3 },
    { ...minimal, sourceUrl: 'javascript:alert(1)' },
    { ...minimal, days: [{ ...minimal.days[0], weekdays: [5, 1, 1, 3] }] },
    { ...minimal, days: [{ ...minimal.days[0], slotKey: 'bad-uuid' }] },
    { ...minimal, days: [{ ...minimal.days[0], slotKey: '123e4567-e89b-42d3-a456-426614174000' }] },
    { ...minimal, days: [{ ...minimal.days[0], exercises: [{ ...minimal.days[0].exercises[0], sets: [{ repMin: 8, repMax: 5 }] }] }] },
  ])('preserves normalized data or exact issues for %#', (input) => {
    expect(boundaryResult(input)).toEqual(referenceResult(input))
  })

  it('preserves rejection details across arbitrary JSON payloads', () => {
    fc.assert(fc.property(fc.jsonValue(), (input) => {
      expect(boundaryResult(input)).toEqual(referenceResult(input))
    }), { numRuns: 250, seed: 20261023 })
  })
})
