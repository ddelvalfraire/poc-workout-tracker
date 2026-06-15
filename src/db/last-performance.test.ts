import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * getLastPerformance executes two `db.select()` chains (recent exercise, then its
 * sets), so it can't use the `.toSQL()` introspection in workouts.test.ts — it
 * needs a mocked db. Each `db.select()` call dequeues the next queued row-array;
 * the builder is chainable and thenable so both `.limit()` (first chain) and a
 * trailing `.orderBy()` (second chain) resolve. The where-condition of each call
 * is captured so the exclude filter can be asserted.
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
      return builder
    },
    orderBy: () => builder,
    limit: () => Promise.resolve(rows),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }
  return builder
}

vi.mock('./index', () => ({
  db: { select: () => makeBuilder() },
}))

import { getLastPerformance } from './workouts'

const USER = 'user_123'
const PERFORMED_AT = new Date('2026-06-01T12:00:00Z')

beforeEach(() => {
  selectResults = []
  selectCount = 0
  whereArgs.length = 0
})

describe('getLastPerformance', () => {
  it('maps the most recent performance to its sets in order', async () => {
    selectResults = [
      [{ exerciseId: 'e1', performedAt: PERFORMED_AT }],
      [
        { reps: 5, weight: 100 },
        { reps: 5, weight: 95 },
      ],
    ]

    const result = await getLastPerformance(USER, 73)

    expect(result).toEqual({
      performedAt: PERFORMED_AT,
      sets: [
        { reps: 5, weight: 100 },
        { reps: 5, weight: 95 },
      ],
    })
  })

  it('returns null and does not query sets when there is no history', async () => {
    selectResults = [[]] // no matching exercise

    const result = await getLastPerformance(USER, 73)

    expect(result).toBeNull()
    expect(selectCount).toBe(1) // second (sets) query never ran
  })

  it('applies the exclude-workout filter when excludeWorkoutId is given', async () => {
    selectResults = [[{ exerciseId: 'e1', performedAt: PERFORMED_AT }], []]

    await getLastPerformance(USER, 73, 'w-latest')

    // The first query's WHERE must carry the excluded workout id as a param (ne filter).
    const { params } = new PgDialect().sqlToQuery(whereArgs[0] as SQL)
    expect(params).toContain('w-latest')
  })
})
