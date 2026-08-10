import { describe, it, expect } from 'vitest'
import {
  aggregateWeekVolume,
  assembleMovements,
  type EvidenceSetRow,
  type StructureMuscleRow,
  type StructureRow,
  type StructureSetRow,
} from './volume-progression'

/**
 * Pure-assembly tests (no db): structure + evidence rows → movement evidence,
 * and the per-week volume table aggregation. The verdict rules themselves are
 * covered in lib/volume-progression.test.ts; here we pin the folding — week
 * grouping, identity keying, deload exclusion, template/top extraction.
 */

const bench = (over: Partial<StructureRow> = {}): StructureRow => ({
  dayPosition: 0,
  exercisePosition: 0,
  programExerciseId: 'pe1',
  wgerExerciseId: 73,
  source: 'wger',
  name: 'Bench Press',
  scheme: 'linear',
  ...over,
})

const benchSets = (programExerciseId = 'pe1'): StructureSetRow[] => [
  { programExerciseId, setNumber: 1, setType: 'working', repMin: 8, repMax: 12, restSec: 120 },
  { programExerciseId, setNumber: 2, setType: 'working', repMin: 8, repMax: 12, restSec: 120 },
]

const chestTag = (programExerciseId = 'pe1'): StructureMuscleRow[] => [
  { programExerciseId, muscle: 'Chest', role: 'primary' },
  { programExerciseId, muscle: 'Triceps', role: 'secondary' },
]

/** Two completed working sets at the prescribed 100 kg with `reps` each. */
const sessionRows = (
  workoutId: string,
  programWeek: number,
  reps: number,
  over: Partial<EvidenceSetRow> = {},
): EvidenceSetRow[] =>
  [1, 2].map((setNumber) => ({
    workoutId,
    programWeek,
    startedAtMs: programWeek * 1000,
    wgerExerciseId: 73,
    source: 'wger' as const,
    setNumber,
    reps,
    weightKg: 100,
    completed: true,
    setType: 'working',
    prescribedLoadKg: 100,
    prescribedRepMin: 8,
    ...over,
  }))

describe('assembleMovements', () => {
  it('folds sessions into per-week beat results under the uniform rep top', () => {
    const [movement] = assembleMovements(
      [bench()],
      benchSets(),
      chestTag(),
      [...sessionRows('w1', 1, 12), ...sessionRows('w2', 2, 10)],
      'all-sets',
      null,
    )
    expect(movement.key).toBe('wger:73')
    expect(movement.primaryGroups).toEqual(['Chest'])
    expect(movement.muscleTagCount).toBe(2)
    expect(movement.weeks.get(1)).toEqual({ beat: true, stalled: false })
    expect(movement.weeks.get(2)).toEqual({ beat: false, stalled: false })
    expect(movement.setTemplate).toEqual({ repMin: 8, repMax: 12, restSec: 120 })
  })

  it('deload-week sessions never testify', () => {
    const [movement] = assembleMovements(
      [bench()],
      benchSets(),
      chestTag(),
      sessionRows('w1', 3, 12),
      'all-sets',
      3,
    )
    expect(movement.weeks.size).toBe(0)
  })

  it('a movement on two days keeps frequency 2 and the FIRST address', () => {
    const [movement] = assembleMovements(
      [bench(), bench({ dayPosition: 2, exercisePosition: 1, programExerciseId: 'pe2' })],
      [...benchSets(), ...benchSets('pe2')],
      [...chestTag(), ...chestTag('pe2')],
      [],
      'all-sets',
      null,
    )
    expect(movement.frequency).toBe(2)
    expect(movement.address).toEqual({ dayPosition: 0, exercisePosition: 0 })
    expect(movement.muscleTagCount).toBe(2) // deduped across occurrences
  })

  it('weekly-volume scheme marks the movement scheme-owned', () => {
    const [movement] = assembleMovements(
      [bench({ scheme: 'weekly-volume' })],
      benchSets(),
      chestTag(),
      [],
      'all-sets',
      null,
    )
    expect(movement.schemeOwnsSets).toBe(true)
  })

  it('evidence for a movement no longer on the plan is dropped (silence)', () => {
    const movements = assembleMovements(
      [bench()],
      benchSets(),
      chestTag(),
      sessionRows('w1', 1, 12, { wgerExerciseId: 999 }),
      'all-sets',
      null,
    )
    expect(movements[0].weeks.size).toBe(0)
  })

  it('a stalled session marks the week stalled', () => {
    const [movement] = assembleMovements(
      [bench()],
      benchSets(),
      chestTag(),
      sessionRows('w1', 2, 6), // under the 8 floor at load
      'all-sets',
      null,
    )
    expect(movement.weeks.get(2)).toEqual({ beat: false, stalled: true })
  })
})

describe('aggregateWeekVolume', () => {
  const muscles = new Map([['wger:73', { primary: ['Chest'], secondary: ['Triceps'] }]])

  it('credits primary 1.0 / secondary 0.5 per completed reps_weight set, per week', () => {
    const weeks = aggregateWeekVolume(
      [
        { programWeek: 1, wgerExerciseId: 73, source: 'wger', metricMode: 'reps_weight' },
        { programWeek: 1, wgerExerciseId: 73, source: 'wger', metricMode: 'reps_weight' },
        { programWeek: 2, wgerExerciseId: 73, source: 'wger', metricMode: 'reps_weight' },
      ],
      muscles,
    )
    expect(weeks.map((w) => w.week)).toEqual([1, 2])
    const chest = (i: number) => weeks[i].groups.find((g) => g.group === 'Chest')?.sets
    const triceps = (i: number) => weeks[i].groups.find((g) => g.group === 'Triceps')?.sets
    expect(chest(0)).toBe(2)
    expect(triceps(0)).toBe(1)
    expect(chest(1)).toBe(1)
  })

  it('unknown identities credit Other; duration sets never count', () => {
    const weeks = aggregateWeekVolume(
      [
        { programWeek: 1, wgerExerciseId: 999, source: 'wger', metricMode: 'reps_weight' },
        { programWeek: 1, wgerExerciseId: 73, source: 'wger', metricMode: 'duration' },
      ],
      muscles,
    )
    expect(weeks[0].groups.find((g) => g.group === 'Other')?.sets).toBe(1)
    expect(weeks[0].groups.find((g) => g.group === 'Chest')?.sets).toBe(0)
  })
})
