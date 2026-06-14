import { describe, it, expect } from 'vitest'
import { listWorkouts, getWorkout, createWorkout } from './workouts'

const USER = 'user_123'
const WORKOUT_ID = '11111111-1111-1111-1111-111111111111'

describe('workouts repository (authorization boundary)', () => {
  it('scopes list queries to the user', () => {
    const { sql, params } = listWorkouts(USER).toSQL()
    expect(sql).toContain('"user_id"')
    expect(params).toContain(USER)
  })

  it('scopes single-workout reads to the user as well as the id', () => {
    const { sql, params } = getWorkout(USER, WORKOUT_ID).toSQL()
    expect(sql).toContain('"user_id"')
    expect(params).toEqual(expect.arrayContaining([USER, WORKOUT_ID]))
  })

  it('stamps the owner on create', () => {
    const { sql, params } = createWorkout(USER, 'Leg Day').toSQL()
    expect(sql).toContain('"user_id"')
    expect(params).toContain(USER)
  })
})
