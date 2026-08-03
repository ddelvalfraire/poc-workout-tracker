import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TrophyContext, TrophyKind } from '@/lib/trophy-kinds'

/**
 * Recording stubs for the Drizzle builders, mirroring goals.test.ts. Selects
 * are a FIFO queue (several functions here issue more than one); the builders
 * are thenable at every chain depth (from/innerJoin/where/orderBy/limit) so
 * queries that await at any point resolve the same queued rows. The insert
 * stub records values + the onConflictDoNothing target — the once-guarantee
 * assertion rides on it.
 */
let selectResults: Record<string, unknown>[][] = []
let insertReturning: Record<string, unknown>[] = []
const inserts: { values: unknown; conflictTarget: unknown }[] = []

interface SelectBuilder extends PromiseLike<Record<string, unknown>[]> {
  from: () => SelectBuilder
  innerJoin: () => SelectBuilder
  where: () => SelectBuilder
  orderBy: () => SelectBuilder
  limit: () => SelectBuilder
}

function makeSelect(): SelectBuilder {
  const result = selectResults.shift() ?? []
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    then: (
      onFulfilled?: ((value: Record<string, unknown>[]) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  }
  return builder as SelectBuilder
}

vi.mock('./index', () => ({
  db: {
    select: () => makeSelect(),
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoNothing: (opts: { target: unknown }) => {
          inserts.push({ values: v, conflictTarget: opts.target })
          return { returning: () => Promise.resolve(insertReturning) }
        },
      }),
    }),
  },
}))

import {
  activeProgramRef,
  countCompletedWorkouts,
  lifetimeTonnageKg,
  listTrophies,
  stampTrophies,
  trophiesAchievedSince,
  workoutFinishFacts,
} from './trophies'

const USER = 'user_123'

beforeEach(() => {
  selectResults = []
  insertReturning = []
  inserts.length = 0
})

describe('stampTrophies', () => {
  it('short-circuits without touching the db when there is nothing to stamp', async () => {
    expect(await stampTrophies(USER, [])).toEqual([])
    expect(inserts).toEqual([])
  })

  it('inserts with the conflict guard and returns only the RETURNING rows', async () => {
    const achievedAt = new Date('2026-08-02T10:00:00Z')
    insertReturning = [
      { id: 't1', kind: 'workouts_1', achievedAt, context: { count: 1, workoutId: 'w1' } },
    ]
    const candidates: { kind: TrophyKind; context: TrophyContext }[] = [
      { kind: 'workouts_1', context: { count: 1, workoutId: 'w1' } },
      { kind: 'workouts_50', context: { count: 50 } },
    ]

    const stamped = await stampTrophies(USER, candidates)

    // Both candidates were offered, each carrying the userId scope…
    expect(inserts).toHaveLength(1)
    expect(inserts[0].values).toEqual([
      { userId: USER, kind: 'workouts_1', context: { count: 1, workoutId: 'w1' } },
      { userId: USER, kind: 'workouts_50', context: { count: 50 } },
    ])
    // …with the (userId, kind) conflict target — the once-guarantee.
    expect(Array.isArray(inserts[0].conflictTarget)).toBe(true)
    expect(inserts[0].conflictTarget).toHaveLength(2)
    // …but only what RETURNING yielded (the newly created row) comes back.
    expect(stamped.map((r) => r.kind)).toEqual(['workouts_1'])
  })
})

describe('reads', () => {
  it('listTrophies returns the queued rows', async () => {
    const achievedAt = new Date('2026-08-01T00:00:00Z')
    selectResults = [[{ id: 't1', kind: 'club_squat_315', achievedAt, context: {} }]]
    const rows = await listTrophies(USER)
    expect(rows).toEqual([{ id: 't1', kind: 'club_squat_315', achievedAt, context: {} }])
  })

  it('trophiesAchievedSince returns the queued window rows', async () => {
    const achievedAt = new Date('2026-08-02T10:00:00Z')
    selectResults = [[{ id: 't2', kind: 'workouts_50', achievedAt, context: { count: 50 } }]]
    const rows = await trophiesAchievedSince(USER, new Date('2026-08-02T09:00:00Z'))
    expect(rows.map((r) => r.kind)).toEqual(['workouts_50'])
  })

  it('countCompletedWorkouts unwraps the count and defaults to 0', async () => {
    selectResults = [[{ value: 42 }]]
    expect(await countCompletedWorkouts(USER)).toBe(42)
    selectResults = [[]]
    expect(await countCompletedWorkouts(USER)).toBe(0)
  })

  it('lifetimeTonnageKg coerces the pg numeric string and defaults to 0', async () => {
    // Postgres SUM over numeric comes back as a string.
    selectResults = [[{ total: '453592.37' }]]
    expect(await lifetimeTonnageKg(USER)).toBe(453592.37)
    selectResults = [[]]
    expect(await lifetimeTonnageKg(USER)).toBe(0)
  })

  it('workoutFinishFacts returns null for an unowned/missing workout', async () => {
    selectResults = [[]]
    expect(await workoutFinishFacts(USER, 'w404')).toBe(null)
  })

  it('workoutFinishFacts combines the row read with the tonnage sum', async () => {
    const completedAt = new Date('2026-08-02T10:00:00Z')
    selectResults = [
      [{ completedAt, programDayId: 'day1' }],
      [{ total: '1234.50' }],
    ]
    expect(await workoutFinishFacts(USER, 'w1')).toEqual({
      completedAt,
      programDayId: 'day1',
      tonnageKg: 1234.5,
    })
  })

  it('activeProgramRef returns the row or null', async () => {
    selectResults = [[{ id: 'p1', mesocycleWeeks: 6 }]]
    expect(await activeProgramRef(USER)).toEqual({ id: 'p1', mesocycleWeeks: 6 })
    selectResults = [[]]
    expect(await activeProgramRef(USER)).toBe(null)
  })
})
