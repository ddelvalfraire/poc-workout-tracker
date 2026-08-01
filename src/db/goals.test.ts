import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs for the Drizzle builders, mirroring bodyweight.test.ts.
 * Selects are a FIFO queue (`selectResults`) because several functions here
 * issue more than one select; each db.select() consumes the next entry. The
 * builders are thenable at every chain depth so queries that await after
 * .where(), .orderBy() or .limit() all resolve the same queued rows.
 */
let selectResults: Record<string, unknown>[][] = []
let updateResults: { id: string }[][] = []
let deleteResults: { id: string }[][] = []
const inserts: unknown[] = []
const updateSets: Record<string, unknown>[] = []
let selectCalls = 0

interface SelectBuilder extends PromiseLike<Record<string, unknown>[]> {
  from: () => SelectBuilder
  where: () => SelectBuilder
  orderBy: () => SelectBuilder
  limit: () => SelectBuilder
}

function makeSelect(): SelectBuilder {
  selectCalls += 1
  const result = selectResults.shift() ?? []
  const builder = {
    from: () => builder,
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
      values: (v: unknown) => {
        inserts.push(v)
        return { returning: () => Promise.resolve([{ id: 'goal1' }]) }
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        updateSets.push(s)
        return {
          where: () => ({ returning: () => Promise.resolve(updateResults.shift() ?? []) }),
        }
      },
    }),
    delete: () => ({
      where: () => ({ returning: () => Promise.resolve(deleteResults.shift() ?? []) }),
    }),
  },
}))

import {
  activeScheduledWeekdays,
  archiveGoal,
  completedWorkoutTimes,
  createGoal,
  deleteGoal,
  markGoalAchieved,
  MAX_ACTIVE_GOALS,
} from './goals'

const USER = 'user_123'

beforeEach(() => {
  selectResults = []
  updateResults = []
  deleteResults = []
  inserts.length = 0
  updateSets.length = 0
  selectCalls = 0
})

describe('createGoal', () => {
  it('inserts a strength goal with its exercise ref columns', async () => {
    selectResults = [[]] // active-count check: under the ceiling

    const result = await createGoal(USER, {
      kind: 'strength',
      target: { e1rmKg: 140 },
      exercise: { wgerExerciseId: 73, source: 'wger', name: 'Squat' },
      deadline: '2026-11-12',
    })

    expect(result).toEqual({ id: 'goal1' })
    expect(inserts[0]).toEqual({
      userId: USER,
      kind: 'strength',
      target: { e1rmKg: 140 },
      deadline: '2026-11-12',
      wgerExerciseId: 73,
      source: 'wger',
      exerciseName: 'Squat',
    })
  })

  it('inserts a consistency goal WITHOUT exercise columns (null by construction)', async () => {
    selectResults = [[]]

    await createGoal(USER, {
      kind: 'consistency',
      target: { targetWeeks: 8, allowedMissesPerWeek: 1 },
      deadline: null,
    })

    expect(inserts[0]).toEqual({
      userId: USER,
      kind: 'consistency',
      target: { targetWeeks: 8, allowedMissesPerWeek: 1 },
      deadline: null,
    })
  })

  it('refuses past the active-goal ceiling', async () => {
    selectResults = [Array.from({ length: MAX_ACTIVE_GOALS }, (_, i) => ({ id: `g${i}` }))]

    await expect(
      createGoal(USER, {
        kind: 'bodyweight',
        target: { weightKg: 80, direction: 'down' },
        deadline: null,
      }),
    ).rejects.toThrow('goal limit reached')
    expect(inserts).toHaveLength(0)
  })
})

describe('markGoalAchieved (idempotent stamp)', () => {
  it('stamps achievedAt once and returns the row', async () => {
    updateResults = [[{ id: 'g1' }]]

    const result = await markGoalAchieved(USER, 'g1')

    expect(result).toEqual({ id: 'g1' })
    expect(updateSets[0]).toHaveProperty('achievedAt')
    expect(updateSets[0].achievedAt).toBeInstanceOf(Date)
  })

  it('returns null when already achieved / unowned (the IS NULL predicate matched nothing)', async () => {
    updateResults = [[]]
    expect(await markGoalAchieved(USER, 'g1')).toBe(null)
  })
})

describe('archiveGoal / deleteGoal (ownership-gated)', () => {
  it('archives an owned active goal', async () => {
    updateResults = [[{ id: 'g1' }]]
    expect(await archiveGoal(USER, 'g1')).toEqual({ id: 'g1' })
    expect(updateSets[0]).toHaveProperty('archivedAt')
  })

  it('returns null archiving a row that is not owned or already archived', async () => {
    updateResults = [[]]
    expect(await archiveGoal(USER, 'g1')).toBe(null)
  })

  it('deletes an owned goal; null otherwise', async () => {
    deleteResults = [[{ id: 'g1' }], []]
    expect(await deleteGoal(USER, 'g1')).toEqual({ id: 'g1' })
    expect(await deleteGoal(USER, 'g2')).toBe(null)
  })
})

describe('streak evidence reads', () => {
  it('completedWorkoutTimes returns the non-null instants', async () => {
    const a = new Date('2026-07-20T10:00:00Z')
    const b = new Date('2026-07-22T10:00:00Z')
    selectResults = [[{ completedAt: a }, { completedAt: null }, { completedAt: b }]]

    expect(await completedWorkoutTimes(USER, new Date('2026-01-01T00:00:00Z'))).toEqual([a, b])
  })

  it('activeScheduledWeekdays unions, dedupes and sorts the active program days', async () => {
    selectResults = [
      [{ id: 'prog1' }],
      [{ weekdays: [5, 1] }, { weekdays: [3, 1] }, { weekdays: [] }],
    ]

    expect(await activeScheduledWeekdays(USER)).toEqual([1, 3, 5])
    expect(selectCalls).toBe(2)
  })

  it('returns [] without a day query when no active program exists', async () => {
    selectResults = [[]]

    expect(await activeScheduledWeekdays(USER)).toEqual([])
    expect(selectCalls).toBe(1)
  })
})
