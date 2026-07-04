import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  workouts,
  workoutExercises,
  sets,
  programs,
  programDays,
  programExercises,
  programSets,
} from './schema'

describe('schema', () => {
  it('defines the three workout tables with snake_case names', () => {
    expect(getTableName(workouts)).toBe('workouts')
    expect(getTableName(workoutExercises)).toBe('workout_exercises')
    expect(getTableName(sets)).toBe('sets')
  })

  it('marks sets.completed as non-null', () => {
    expect(getTableColumns(sets).completed.notNull).toBe(true)
  })

  it('defines the four program tables with snake_case names', () => {
    expect(getTableName(programs)).toBe('programs')
    expect(getTableName(programDays)).toBe('program_days')
    expect(getTableName(programExercises)).toBe('program_exercises')
    expect(getTableName(programSets)).toBe('program_sets')
  })

  it('makes the metric model additive on live sets (non-null, defaulted)', () => {
    const cols = getTableColumns(sets)
    expect(cols.metricMode.notNull).toBe(true)
    expect(cols.metricMode.hasDefault).toBe(true)
    expect(cols.durationSec.notNull).toBe(false)
    expect(cols.distanceM.notNull).toBe(false)
  })

  it('makes workout provenance columns nullable', () => {
    const cols = getTableColumns(workouts)
    expect(cols.programDayId.notNull).toBe(false)
    expect(cols.programWeek.notNull).toBe(false)
  })

  it('guards ordering uniqueness on every position-addressed program table', () => {
    // Concurrent appends read max(position) then insert; without these unique
    // constraints two racers could land at the same position and make the
    // position-addressed patch ops ambiguous.
    const dayUniques = getTableConfig(programDays).uniqueConstraints
    expect(dayUniques.map((u) => u.columns.map((c) => c.name).sort())).toContainEqual([
      'position',
      'program_id',
    ])

    const exerciseUniques = getTableConfig(programExercises).uniqueConstraints
    expect(exerciseUniques.map((u) => u.columns.map((c) => c.name).sort())).toContainEqual([
      'position',
      'program_day_id',
    ])

    const setUniques = getTableConfig(programSets).uniqueConstraints
    expect(setUniques.map((u) => u.columns.map((c) => c.name).sort())).toContainEqual([
      'program_exercise_id',
      'set_number',
    ])
  })

  it('defaults program_sets.set_type and metric_mode (non-null)', () => {
    const cols = getTableColumns(programSets)
    expect(cols.setType.notNull).toBe(true)
    expect(cols.setType.hasDefault).toBe(true)
    expect(cols.metricMode.notNull).toBe(true)
    expect(cols.metricMode.hasDefault).toBe(true)
  })
})
