import { describe, it, expect } from 'vitest'
import { listProgramWorkouts } from './programs'

const USER = 'user_123'
const PROGRAM_ID = '22222222-2222-2222-2222-222222222222'

describe('listProgramWorkouts (program week view)', () => {
  it('scopes to the user AND the program (double gate, module convention)', () => {
    const { sql, params } = listProgramWorkouts(USER, PROGRAM_ID).toSQL()
    expect(sql).toContain('"user_id"')
    expect(sql).toContain('"program_id"')
    expect(params).toEqual(expect.arrayContaining([USER, PROGRAM_ID]))
  })

  it('carries provenance and the summary aggregates the day cards render', () => {
    const { sql } = listProgramWorkouts(USER, PROGRAM_ID).toSQL()
    expect(sql).toContain('"program_day_id"')
    expect(sql).toContain('"program_week"')
    expect(sql).toMatch(/count/i) // set counts
    expect(sql).toMatch(/sum/i) // completed sets + volume
    expect(sql).toMatch(/group by/i)
    expect(sql).toMatch(/order by .* desc/i) // freshest first
  })
})
