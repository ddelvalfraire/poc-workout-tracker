import { describe, it, expect } from 'vitest'
import {
  listWorkouts,
  createWorkout,
  listWorkoutSummaries,
  getWorkoutDetail,
  deleteWorkout,
} from './workouts'

const USER = 'user_123'
const WORKOUT_ID = '11111111-1111-1111-1111-111111111111'

describe('workouts repository (authorization boundary)', () => {
  it('scopes list queries to the user', () => {
    const { sql, params } = listWorkouts(USER).toSQL()
    expect(sql).toContain('"user_id"')
    expect(params).toContain(USER)
  })

  it('stamps the owner on create', () => {
    const { sql, params } = createWorkout(USER, 'Leg Day').toSQL()
    expect(sql).toContain('"user_id"')
    expect(params).toContain(USER)
  })

  it('scopes the history summary query to the user', () => {
    const { sql, params } = listWorkoutSummaries(USER).toSQL()
    expect(sql).toContain('"user_id"')
    expect(sql).toMatch(/count/i) // aggregate counts present
    expect(params).toContain(USER)
  })

  it('scopes the detail query to the user as well as the id', () => {
    const { sql, params } = getWorkoutDetail(USER, WORKOUT_ID).toSQL()
    expect(sql).toContain('"user_id"')
    expect(params).toEqual(expect.arrayContaining([USER, WORKOUT_ID]))
  })

  it('scopes the delete to the user as well as the id', () => {
    const { sql, params } = deleteWorkout(USER, WORKOUT_ID).toSQL()
    expect(sql).toContain('"user_id"')
    expect(params).toEqual(expect.arrayContaining([USER, WORKOUT_ID]))
  })
})
