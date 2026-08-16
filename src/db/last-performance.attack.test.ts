import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * ADVERSARIAL VERIFICATION (#211) — the sessionNote ride-along's blind spot:
 * getLastPerformance picks "the previous session" with NO skipped filter, so
 * a prior instance the user SKIPPED (often carrying exactly the note worth
 * echoing — "shoulder tweak") is both the ghost source and the echo source.
 * These tests document that eligibility, mocked-db idiom per
 * last-performance.test.ts.
 */

let selectResults: unknown[][] = []
const whereArgs: unknown[] = []

function makeBuilder() {
  const rows = selectResults.shift() ?? []
  const builder: Record<string, unknown> = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
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
  whereArgs.length = 0
})

describe('ATTACK: skipped prior instances feed the echo', () => {
  it('the recent-instance WHERE carries no skipped/completed predicate — a skipped session is eligible', async () => {
    selectResults = [
      [
        {
          exerciseId: 'e1',
          performedAt: PERFORMED_AT,
          noteBody: null,
          notePinned: null,
          // The prior instance was skipped; only its excuse note exists.
          sessionNote: 'shoulder tweak — skipped',
        },
      ],
      [], // a skipped instance has no set rows
    ]

    const result = await getLastPerformance(USER, 'wger', 73)

    // The note of the SKIPPED instance rides through as the echo source…
    expect(result?.sessionNote).toBe('shoulder tweak — skipped')
    expect(result?.sets).toEqual([])

    // …and the query text confirms no filter could have fenced it out:
    // neither `skipped` nor any completion predicate appears in the WHERE.
    const { sql } = new PgDialect().sqlToQuery(whereArgs[0] as SQL)
    expect(sql).not.toContain('skipped')
    expect(sql).not.toContain('completed')
  })
})
