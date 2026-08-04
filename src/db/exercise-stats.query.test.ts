import { describe, it, expect } from 'vitest'
import { loggedExercisesQuery } from './exercise-stats'

/**
 * SQL-shape test for the library query (the workouts.test.ts pattern:
 * `.toSQL()` on the real builder). Separate file on purpose — the sibling
 * exercise-stats.test.ts mocks `./index`, and a mocked builder has no SQL
 * to introspect.
 */

const USER = 'user_123'

describe('loggedExercisesQuery (SQL shape)', () => {
  it('scopes to the user, completed workouts only, LEFT-joins sets, ascending order', () => {
    const { sql, params } = loggedExercisesQuery(USER).toSQL()

    expect(params).toContain(USER)
    expect(sql).toContain('"user_id"')
    expect(sql).toMatch(/"completed_at" is not null/i)
    // LEFT join keeps set-less occurrences listed (navigation-first rule).
    expect(sql).toMatch(/left join "sets"/i)
    expect(sql).toMatch(/inner join "workouts"/i)
    // Ascending session start — the aggregate's latest-name/lastPrAt contract.
    expect(sql).toMatch(/order by "workouts"\."started_at" asc/i)
    // The alive-row scoring columns ride along.
    for (const column of ['"logging_type"', '"reps"', '"weight"', '"set_type"', '"metric_mode"']) {
      expect(sql).toContain(column)
    }
  })
})
