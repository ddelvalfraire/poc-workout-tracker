import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * getExerciseHistoryBefore is a single awaited `db.select()` chain
 * (select→from→innerJoin→innerJoin→where), so it uses the same mocked-db harness
 * as last-performance.test.ts: a chainable, thenable builder whose `.where()`
 * resolves to the next queued row-array. The where-condition is captured so the
 * user/time/ids scoping can be asserted via PgDialect param introspection.
 */
let selectResults: unknown[][] = []
let selectCount = 0
const whereArgs: unknown[] = []

function nextRows(): unknown[] {
  return selectResults.shift() ?? []
}

function makeBuilder() {
  selectCount += 1
  const rows = nextRows()
  const builder: Record<string, unknown> = {
    from: () => builder,
    innerJoin: () => builder,
    where: (cond: unknown) => {
      whereArgs.push(cond)
      return Promise.resolve(rows)
    },
  }
  return builder
}

vi.mock('./index', () => ({
  db: { select: () => makeBuilder() },
}))

import { getExerciseHistoryBefore } from './workouts'

const USER = 'user_123'
const BEFORE = new Date('2026-06-15T12:00:00Z')

beforeEach(() => {
  selectResults = []
  selectCount = 0
  whereArgs.length = 0
})

describe('getExerciseHistoryBefore', () => {
  it('returns [] without querying when no exercise ids are given', async () => {
    const result = await getExerciseHistoryBefore(USER, [], BEFORE)

    expect(result).toEqual([])
    expect(selectCount).toBe(0) // the empty-id guard avoids inArray([]) invalid SQL
  })

  it('returns the flat set rows from the query', async () => {
    selectResults = [
      [
        { wgerExerciseId: 73, reps: 5, weight: 100 },
        { wgerExerciseId: 73, reps: 3, weight: 110 },
        { wgerExerciseId: 91, reps: null, weight: null },
      ],
    ]

    const result = await getExerciseHistoryBefore(USER, [73, 91], BEFORE)

    expect(result).toEqual([
      { wgerExerciseId: 73, reps: 5, weight: 100 },
      { wgerExerciseId: 73, reps: 3, weight: 110 },
      { wgerExerciseId: 91, reps: null, weight: null },
    ])
  })

  it('scopes the query by user, the exercise ids, and the time bound', async () => {
    selectResults = [[]]

    await getExerciseHistoryBefore(USER, [73, 91], BEFORE)

    const { params } = new PgDialect().sqlToQuery(whereArgs[0] as SQL)
    expect(params).toContain(USER) // user-scoping (no cross-user leak)
    expect(params).toContain(73) // inArray ids
    expect(params).toContain(91)
    // The `startedAt < before` bound carries the cutoff (Date or its serialization).
    expect(
      params.some((p) => p === BEFORE || p === BEFORE.toISOString() || p === BEFORE.toUTCString()),
    ).toBe(true)
  })
})
