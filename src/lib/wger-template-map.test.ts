import { describe, it, expect } from 'vitest'
import {
  mapWgerRoutineToProgram,
  deriveMesocycleWeeks,
  pickTemplateIcon,
  type WgerRoutineStructure,
} from './wger-template-map'
import { parseProgramInput } from './program-input'

/** Synthetic catalog: wger exercise id → English name. */
const CATALOG = new Map<number, string>([
  [73, 'Bench Press'],
  [105, 'Squat'],
  [211, 'Biceps Curl'],
  [300, 'Plank'],
])

/** One config row the way wger serializes it (decimal value as a string). */
function config(value: number | string, iteration = 1) {
  return { iteration, value, operation: 'r', step: 'na', repeat: false, requirements: null }
}

/** A slot entry with sensible defaults; override per test. */
function entry(exercise: number, overrides: Record<string, unknown> = {}) {
  return {
    exercise,
    repetition_unit: 1,
    weight_unit: 1,
    set_nr_configs: [config('3.00')],
    repetitions_configs: [config('8.00')],
    max_repetitions_configs: [],
    weight_configs: [],
    rir_configs: [],
    rest_configs: [],
    ...overrides,
  }
}

function day(name: string, entriesBySlot: unknown[][], overrides: Record<string, unknown> = {}) {
  return {
    name,
    is_rest: false,
    slots: entriesBySlot.map((entries) => ({ entries })),
    ...overrides,
  }
}

function routine(days: unknown[], overrides: Record<string, unknown> = {}): WgerRoutineStructure {
  return {
    id: 42,
    name: 'Test Routine',
    description: 'A plan.',
    start: '2024-01-01',
    end: '2024-02-26',
    days,
    ...overrides,
  }
}

describe('deriveMesocycleWeeks', () => {
  it('rounds the start→end span to whole weeks', () => {
    expect(deriveMesocycleWeeks('2024-01-01', '2024-02-26')).toBe(8)
  })

  it('defaults to 4 when dates are missing or malformed', () => {
    expect(deriveMesocycleWeeks(undefined, undefined)).toBe(4)
    expect(deriveMesocycleWeeks('not-a-date', '2024-02-26')).toBe(4)
    expect(deriveMesocycleWeeks(null, '2024-02-26')).toBe(4)
  })

  it('defaults to 4 when the end is not after the start', () => {
    expect(deriveMesocycleWeeks('2024-02-26', '2024-01-01')).toBe(4)
  })

  it('clamps to the schema bounds (1..52)', () => {
    expect(deriveMesocycleWeeks('2024-01-01', '2024-01-03')).toBe(1)
    expect(deriveMesocycleWeeks('2020-01-01', '2026-01-01')).toBe(52)
  })
})

describe('pickTemplateIcon', () => {
  it('matches keywords in name or description, first rule wins', () => {
    expect(pickTemplateIcon('Starting Strength', '')).toBe('🏋️')
    expect(pickTemplateIcon('German Volume', 'hypertrophy focus')).toBe('💪')
    expect(pickTemplateIcon('PPL', 'push pull legs')).toBe('🔀')
  })

  it('falls back to the default icon', () => {
    expect(pickTemplateIcon('Mystery Plan', 'nothing matches')).toBe('📋')
  })
})

describe('mapWgerRoutineToProgram', () => {
  it('maps days, sets, reps, weight, RIR and rest onto the program shape', () => {
    const r = routine([
      day('Day A', [
        [
          entry(73, {
            set_nr_configs: [config('3.00')],
            repetitions_configs: [config('5.00')],
            max_repetitions_configs: [config('8.00')],
            weight_configs: [config('100.00')],
            rir_configs: [config('2.00')],
            rest_configs: [config('120.00')],
          }),
        ],
      ]),
    ])

    const result = mapWgerRoutineToProgram(r, CATALOG)

    expect(result).not.toBeNull()
    const input = result!.input
    expect(input.name).toBe('Test Routine')
    expect(input.status).toBe('draft')
    expect(input.mesocycleWeeks).toBe(8)
    expect(input.description).toBe('A plan.')
    expect(input.sourceUrl).toBe('https://wger.de/en/routine/42/view')
    expect(input.days).toHaveLength(1)
    const exercise = input.days[0].exercises[0]
    expect(exercise.wgerExerciseId).toBe(73)
    expect(exercise.name).toBe('Bench Press')
    expect(exercise.sets).toHaveLength(3)
    expect(exercise.sets[0]).toEqual({
      repMin: 5,
      repMax: 8,
      suggestedLoadKg: 100,
      rir: 2,
      restSec: 120,
    })
    expect(result!.skipped).toEqual([])
  })

  it('produces input that passes parseProgramInput', () => {
    const r = routine([day('Day A', [[entry(73)], [entry(105), entry(211)]])])

    const result = mapWgerRoutineToProgram(r, CATALOG)

    expect(() => parseProgramInput(result!.input)).not.toThrow()
  })

  it('treats a fixed rep count (no max config) as repMin === repMax', () => {
    const r = routine([day('Day A', [[entry(73)]])])

    const sets = mapWgerRoutineToProgram(r, CATALOG)!.input.days[0].exercises[0].sets

    expect(sets[0].repMin).toBe(8)
    expect(sets[0].repMax).toBe(8)
  })

  it('uses the lowest-iteration config as the baseline', () => {
    const r = routine([
      day('Day A', [
        [entry(73, { repetitions_configs: [config('12.00', 3), config('8.00', 1)] })],
      ]),
    ])

    const sets = mapWgerRoutineToProgram(r, CATALOG)!.input.days[0].exercises[0].sets

    expect(sets[0].repMin).toBe(8)
  })

  it('converts lb loads to canonical kg and drops bodyweight-unit loads', () => {
    const r = routine([
      day('Day A', [
        [entry(73, { weight_unit: 2, weight_configs: [config('225.00')] })],
        [entry(105, { weight_unit: 3, weight_configs: [config('80.00')] })],
      ]),
    ])

    const exercises = mapWgerRoutineToProgram(r, CATALOG)!.input.days[0].exercises

    expect(exercises[0].sets[0].suggestedLoadKg).toBeCloseTo(102.06, 2)
    expect(exercises[1].sets[0].suggestedLoadKg).toBeUndefined()
  })

  it('maps until-failure/max-reps units to amrap sets without rep targets', () => {
    const r = routine([day('Day A', [[entry(73, { repetition_unit: 2 })]])])

    const sets = mapWgerRoutineToProgram(r, CATALOG)!.input.days[0].exercises[0].sets

    expect(sets[0].setType).toBe('amrap')
    expect(sets[0].repMin).toBeUndefined()
  })

  it('maps seconds and minutes units to timed sets with durationSec', () => {
    const r = routine([
      day('Day A', [
        [entry(300, { repetition_unit: 3, repetitions_configs: [config('45.00')] })],
        [entry(73, { repetition_unit: 4, repetitions_configs: [config('2.00')] })],
      ]),
    ])

    const exercises = mapWgerRoutineToProgram(r, CATALOG)!.input.days[0].exercises

    expect(exercises[0].sets[0]).toMatchObject({ metricMode: 'duration', durationSec: 45 })
    expect(exercises[1].sets[0]).toMatchObject({ metricMode: 'duration', durationSec: 120 })
  })

  it('skips distance-unit entries with a note instead of failing', () => {
    const r = routine([day('Day A', [[entry(73)], [entry(105, { repetition_unit: 6 })]])])

    const result = mapWgerRoutineToProgram(r, CATALOG)!

    expect(result.input.days[0].exercises).toHaveLength(1)
    expect(result.skipped).toEqual(['Day A: Squat uses an unsupported unit, skipped'])
  })

  it('skips exercises missing from the catalog with a note', () => {
    const r = routine([day('Day A', [[entry(73)], [entry(9999)]])])

    const result = mapWgerRoutineToProgram(r, CATALOG)!

    expect(result.input.days[0].exercises.map((e) => e.wgerExerciseId)).toEqual([73])
    expect(result.skipped).toEqual(['Day A: unknown exercise #9999 skipped'])
  })

  it('marks multi-entry slots as supersets with per-program group numbers', () => {
    const r = routine([
      day('Day A', [[entry(73), entry(211)], [entry(105)]]),
      day('Day B', [[entry(105), entry(211)]]),
    ])

    const days = mapWgerRoutineToProgram(r, CATALOG)!.input.days

    expect(days[0].exercises.map((e) => e.supersetGroup)).toEqual([1, 1, undefined])
    expect(days[1].exercises.map((e) => e.supersetGroup)).toEqual([2, 2])
  })

  it('drops rest days and skip-notes days with nothing mappable', () => {
    const r = routine([
      day('Rest', [], { is_rest: true }),
      day('Ghost', [[entry(9999)]]),
      day('Day A', [[entry(73)]]),
    ])

    const result = mapWgerRoutineToProgram(r, CATALOG)!

    expect(result.input.days.map((d) => d.name)).toEqual(['Day A'])
    expect(result.skipped).toContain('Ghost: no mappable exercises, day skipped')
  })

  it('returns null when no trainable days survive', () => {
    const empty = mapWgerRoutineToProgram(routine([]), CATALOG)
    const allRest = mapWgerRoutineToProgram(routine([day('Rest', [], { is_rest: true })]), CATALOG)

    expect(empty).toBeNull()
    expect(allRest).toBeNull()
  })

  it('falls back to generated names and defaults on missing metadata', () => {
    const r = routine([day('', [[entry(73)]])], {
      name: '  ',
      description: null,
      start: null,
      end: null,
    })

    const input = mapWgerRoutineToProgram(r, CATALOG)!.input

    expect(input.name).toBe('wger routine 42')
    expect(input.days[0].name).toBe('Day 1')
    expect(input.mesocycleWeeks).toBe(4)
    expect(input.description).toBeUndefined()
    expect(input.icon).toBe('📋')
  })

  it('clamps oversized upstream values instead of failing validation', () => {
    const r = routine([
      day('Day A', [
        [
          entry(73, {
            set_nr_configs: [config('50.00')],
            rest_configs: [config('99999.00')],
            rir_configs: [config('50.00')],
          }),
        ],
      ]),
    ])

    const result = mapWgerRoutineToProgram(r, CATALOG)!
    const sets = result.input.days[0].exercises[0].sets

    expect(sets).toHaveLength(10)
    expect(sets[0].restSec).toBe(3600)
    expect(sets[0].rir).toBe(20)
    expect(() => parseProgramInput(result.input)).not.toThrow()
  })

  it('survives malformed days, slots and entries without throwing', () => {
    const r = routine([
      null,
      'garbage',
      { name: 'Day A', is_rest: false, slots: [null, { entries: [null, 7, entry(73)] }] },
    ])

    const result = mapWgerRoutineToProgram(r, CATALOG)!

    expect(result.input.days[0].exercises.map((e) => e.wgerExerciseId)).toEqual([73])
  })
})
