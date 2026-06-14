import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { workouts, workoutExercises, sets } from './schema'

describe('schema', () => {
  it('defines the three workout tables with snake_case names', () => {
    expect(getTableName(workouts)).toBe('workouts')
    expect(getTableName(workoutExercises)).toBe('workout_exercises')
    expect(getTableName(sets)).toBe('sets')
  })

  it('marks sets.completed as non-null', () => {
    expect(getTableColumns(sets).completed.notNull).toBe(true)
  })
})
