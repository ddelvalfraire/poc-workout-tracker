import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * Mocked-db harness for the multi-select exercise-stats module, mirroring
 * program-stats.test.ts: each `db.select()` dequeues the next queued
 * row-array; the builder is chainable and thenable (this module's chains end
 * at `.orderBy()` or `.offset()`). Every where-condition is captured so the
 * user/exercise/source/completed scoping can be asserted via PgDialect
 * introspection; limit/offset args are captured for the pagination guard.
 */
let selectResults: unknown[][] = []
let selectCount = 0
const whereArgs: unknown[] = []
const limitArgs: unknown[] = []
const offsetArgs: unknown[] = []

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
    groupBy: () => builder,
    orderBy: () => builder,
    limit: (n: unknown) => {
      limitArgs.push(n)
      return builder
    },
    offset: (n: unknown) => {
      offsetArgs.push(n)
      return builder
    },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }
  return builder
}

vi.mock('./index', () => ({
  db: { select: () => makeBuilder() },
}))
// getBodyweightKg reads its own table; mocked so the select queue stays this
// module's own reads and the test controls the scoring bodyweight.
vi.mock('./preferences', () => ({
  getBodyweightKg: vi.fn(async () => null),
}))

import {
  aggregateExerciseStats,
  aggregateLoggedExercises,
  getExerciseStats,
  getExerciseSessions,
  listLoggedExercises,
  type ExerciseStatsRow,
  type LoggedExerciseRow,
} from './exercise-stats'
import { getBodyweightKg } from './preferences'

const USER = 'user_123'
const S1 = new Date('2026-07-01T10:00:00Z')
const S2 = new Date('2026-07-08T10:00:00Z')
const S3 = new Date('2026-07-15T10:00:00Z')

/** One flat query row; overrides on top of a completed weight_reps default. */
function row(over: Partial<ExerciseStatsRow> = {}): ExerciseStatsRow {
  return {
    workoutId: 'w1',
    startedAt: S1,
    reps: 5,
    weight: 100,
    completed: true,
    metricMode: 'reps_weight',
    ...over,
  }
}

beforeEach(() => {
  selectResults = []
  selectCount = 0
  whereArgs.length = 0
  limitArgs.length = 0
  offsetArgs.length = 0
  vi.mocked(getBodyweightKg).mockClear()
  vi.mocked(getBodyweightKg).mockResolvedValue(null)
})

describe('aggregateExerciseStats', () => {
  it('derives records and an ascending trend from weight_reps history', () => {
    // Arrange: two sessions, the second heavier.
    const rows = [
      row({ workoutId: 'w1', startedAt: S1, reps: 5, weight: 100 }),
      row({ workoutId: 'w1', startedAt: S1, reps: 8, weight: 90 }),
      row({ workoutId: 'w2', startedAt: S2, reps: 5, weight: 105 }),
    ]

    // Act
    const stats = aggregateExerciseStats(rows, 'weight_reps')

    // Assert
    expect(stats.totalSessions).toBe(2)
    expect(stats.totalCompletedSets).toBe(3)
    expect(stats.trend.map((p) => p.workoutId)).toEqual(['w1', 'w2'])
    expect(stats.records.bestE1rm).toMatchObject({
      workoutId: 'w2',
      performedAt: S2,
      reps: 5,
      weightKg: 105,
    })
    expect(stats.records.bestE1rm!.e1rm).toBeCloseTo(105 * (1 + 5 / 30), 10)
    expect(stats.records.heaviestLoadKg).toMatchObject({ workoutId: 'w2', weightKg: 105 })
    expect(stats.records.mostReps).toMatchObject({ workoutId: 'w1', reps: 8 })
    // Volume: w1 = 5×100 + 8×90 = 1220; w2 = 525.
    expect(stats.records.bestSessionVolumeKg).toMatchObject({ workoutId: 'w1', volumeKg: 1220 })
  })

  it('keeps ties on the earliest session (strictly-greater policy)', () => {
    const rows = [
      row({ workoutId: 'w1', startedAt: S1, reps: 5, weight: 100 }),
      row({ workoutId: 'w2', startedAt: S2, reps: 5, weight: 100 }),
    ]

    const stats = aggregateExerciseStats(rows, 'weight_reps')

    expect(stats.records.bestE1rm!.workoutId).toBe('w1')
    expect(stats.records.heaviestLoadKg!.workoutId).toBe('w1')
    expect(stats.records.mostReps!.workoutId).toBe('w1')
    expect(stats.records.bestSessionVolumeKg!.workoutId).toBe('w1')
    expect(stats.trend).toHaveLength(2)
  })

  it('returns null load records but still derives mostReps when no set is e1rm-scorable', () => {
    // bodyweight_reps with no stored bodyweight: load is unknowable.
    const rows = [
      row({ workoutId: 'w1', reps: 12, weight: null }),
      row({ workoutId: 'w1', reps: 15, weight: null }),
    ]

    const stats = aggregateExerciseStats(rows, 'bodyweight_reps', null)

    expect(stats.records.bestE1rm).toBeNull()
    expect(stats.records.heaviestLoadKg).toBeNull()
    expect(stats.records.bestSessionVolumeKg).toBeNull()
    expect(stats.trend).toEqual([])
    expect(stats.records.mostReps).toMatchObject({ reps: 15 })
    expect(stats.totalCompletedSets).toBe(2)
  })

  it('scores bodyweight types over the effective load', () => {
    const rows = [
      // weighted: 80 bw + 20 added = 100 effective
      row({ workoutId: 'w1', startedAt: S1, reps: 5, weight: 20 }),
      // heavier added weight in the later session
      row({ workoutId: 'w2', startedAt: S2, reps: 5, weight: 25 }),
    ]

    const stats = aggregateExerciseStats(rows, 'weighted_bodyweight', 80)

    expect(stats.records.bestE1rm).toMatchObject({ workoutId: 'w2', weightKg: 105 })
    expect(stats.trend.map((p) => p.workoutId)).toEqual(['w1', 'w2'])
  })

  it('skips assisted sets whose assistance meets or exceeds bodyweight', () => {
    const rows = [
      row({ workoutId: 'w1', reps: 5, weight: 80 }), // load 0 → unscorable
      row({ workoutId: 'w1', reps: 5, weight: 20 }), // load 60
    ]

    const stats = aggregateExerciseStats(rows, 'assisted_bodyweight', 80)

    expect(stats.records.heaviestLoadKg).toMatchObject({ weightKg: 60 })
    expect(stats.records.bestE1rm).toMatchObject({ weightKg: 60 })
  })

  it('counts null-weight machine sets without letting them score load or volume', () => {
    const rows = [
      row({ workoutId: 'w1', reps: 10, weight: null }),
      row({ workoutId: 'w1', reps: 5, weight: 100 }),
    ]

    const stats = aggregateExerciseStats(rows, 'weight_reps')

    expect(stats.totalCompletedSets).toBe(2)
    expect(stats.records.heaviestLoadKg).toMatchObject({ weightKg: 100 })
    expect(stats.records.mostReps).toMatchObject({ reps: 10 })
    // Volume counts only the both-non-null row: 5×100.
    expect(stats.records.bestSessionVolumeKg).toMatchObject({ volumeKg: 500 })
  })

  it('counts duration-mode sets but produces no records or trend from them', () => {
    const rows = [
      row({ workoutId: 'w1', reps: null, weight: null, metricMode: 'duration' }),
      row({ workoutId: 'w1', reps: null, weight: null, metricMode: 'duration' }),
    ]

    const stats = aggregateExerciseStats(rows, 'weight_reps')

    expect(stats.totalSessions).toBe(1)
    expect(stats.totalCompletedSets).toBe(2)
    expect(stats.records).toEqual({
      bestE1rm: null,
      heaviestLoadKg: null,
      mostReps: null,
      bestSessionVolumeKg: null,
    })
    expect(stats.trend).toEqual([])
  })

  it('ignores stray reps on non-reps_weight rows for the rep record', () => {
    // Nothing in the write path forces reps null on duration rows — a stray
    // value must not claim the all-time rep record.
    const rows = [
      row({ workoutId: 'w1', reps: 8, weight: 100 }),
      row({ workoutId: 'w1', reps: 30, weight: null, metricMode: 'duration' }),
    ]

    const stats = aggregateExerciseStats(rows, 'weight_reps')

    expect(stats.records.mostReps).toMatchObject({ reps: 8 })
  })

  it('never scores uncompleted sets', () => {
    const rows = [
      row({ workoutId: 'w1', reps: 5, weight: 100 }),
      // Heavier but abandoned — must not become the record.
      row({ workoutId: 'w2', startedAt: S2, reps: 5, weight: 200, completed: false }),
    ]

    const stats = aggregateExerciseStats(rows, 'weight_reps')

    expect(stats.totalSessions).toBe(1)
    expect(stats.totalCompletedSets).toBe(1)
    expect(stats.records.bestE1rm).toMatchObject({ weightKg: 100 })
    expect(stats.records.heaviestLoadKg).toMatchObject({ weightKg: 100 })
  })

  it('picks the highest-volume session across sessions', () => {
    const rows = [
      row({ workoutId: 'w1', startedAt: S1, reps: 5, weight: 100 }), // 500
      row({ workoutId: 'w2', startedAt: S2, reps: 10, weight: 80 }), // 800
      row({ workoutId: 'w3', startedAt: S3, reps: 3, weight: 120 }), // 360
    ]

    const stats = aggregateExerciseStats(rows, 'weight_reps')

    expect(stats.records.bestSessionVolumeKg).toMatchObject({ workoutId: 'w2', volumeKg: 800 })
  })

  it('returns zeroed totals and null records for empty history', () => {
    const stats = aggregateExerciseStats([], 'weight_reps')

    expect(stats.totalSessions).toBe(0)
    expect(stats.totalCompletedSets).toBe(0)
    expect(stats.records.bestE1rm).toBeNull()
    expect(stats.trend).toEqual([])
  })

  it('does not mutate its input rows', () => {
    const rows = [row()]
    const snapshot = structuredClone(rows)

    aggregateExerciseStats(rows, 'weight_reps')

    expect(rows).toEqual(snapshot)
  })
})

describe('getExerciseStats', () => {
  it('scopes the query to user, composite exercise identity, and completed workouts', async () => {
    selectResults = [
      [
        {
          workoutId: 'w1',
          startedAt: S1,
          exerciseName: 'Bench Press',
          loggingType: 'weight_reps',
          reps: 5,
          weight: 100,
          completed: true,
          metricMode: 'reps_weight',
        },
      ],
    ]

    const stats = await getExerciseStats(USER, 'wger', 42)

    expect(stats).not.toBeNull()
    expect(stats!.exercise).toEqual({
      wgerExerciseId: 42,
      source: 'wger',
      name: 'Bench Press',
      loggingType: 'weight_reps',
    })
    expect(stats!.records.bestE1rm).toMatchObject({ weightKg: 100 })
    const where = new PgDialect().sqlToQuery(whereArgs[0] as SQL)
    expect(where.params).toContain(USER)
    expect(where.params).toContain(42)
    expect(where.params).toContain('wger')
    expect(where.sql).toContain('"completed_at" is not null')
  })

  it('lets the latest denormalized name and loggingType win', async () => {
    selectResults = [
      [
        {
          workoutId: 'w1',
          startedAt: S1,
          exerciseName: 'Pull-up',
          loggingType: 'bodyweight_reps',
          reps: 10,
          weight: null,
          completed: true,
          metricMode: 'reps_weight',
        },
        {
          workoutId: 'w2',
          startedAt: S2,
          exerciseName: 'Weighted Pull-up',
          loggingType: 'weighted_bodyweight',
          reps: 5,
          weight: 20,
          completed: true,
          metricMode: 'reps_weight',
        },
      ],
    ]
    vi.mocked(getBodyweightKg).mockResolvedValue(80)

    const stats = await getExerciseStats(USER, 'wger', 7)

    expect(stats!.exercise.name).toBe('Weighted Pull-up')
    expect(stats!.exercise.loggingType).toBe('weighted_bodyweight')
    // Scoring runs under the winning loggingType: w2 loads 80 + 20 = 100.
    expect(stats!.records.heaviestLoadKg).toMatchObject({ workoutId: 'w2', weightKg: 100 })
  })

  it('returns null when the user has no completed history of the exercise', async () => {
    selectResults = [[]]

    const stats = await getExerciseStats(USER, 'custom', 42)

    expect(stats).toBeNull()
  })
})

describe('getExerciseSessions', () => {
  it('groups a page of sessions with their set rows, newest first', async () => {
    selectResults = [
      // Page query: newest first.
      [
        { workoutId: 'w2', workoutName: 'Push B', performedAt: S2 },
        { workoutId: 'w1', workoutName: null, performedAt: S1 },
      ],
      // Set rows for the paged workouts.
      [
        {
          workoutId: 'w1',
          setNumber: 1,
          reps: 5,
          weight: 100,
          completed: true,
          metricMode: 'reps_weight',
          durationSec: null,
          distanceM: null,
        },
        {
          workoutId: 'w2',
          setNumber: 1,
          reps: 5,
          weight: 105,
          completed: true,
          metricMode: 'reps_weight',
          durationSec: null,
          distanceM: null,
        },
        {
          workoutId: 'w2',
          setNumber: 2,
          reps: null,
          weight: null,
          completed: false,
          metricMode: 'duration',
          durationSec: 60,
          distanceM: null,
        },
      ],
    ]

    const sessions = await getExerciseSessions(USER, 'wger', 42, { limit: 20, offset: 0 })

    expect(sessions.map((s) => s.workoutId)).toEqual(['w2', 'w1'])
    expect(sessions[0].sets).toEqual([
      {
        setNumber: 1,
        reps: 5,
        weight: 105,
        completed: true,
        metricMode: 'reps_weight',
        durationSec: null,
        distanceM: null,
      },
      {
        setNumber: 2,
        reps: null,
        weight: null,
        completed: false,
        metricMode: 'duration',
        durationSec: 60,
        distanceM: null,
      },
    ])
    expect(sessions[1].workoutName).toBeNull()
    // Both queries scope to owner + composite identity; the page query also
    // gates on completed workouts.
    const page = new PgDialect().sqlToQuery(whereArgs[0] as SQL)
    expect(page.params).toContain(USER)
    expect(page.params).toContain(42)
    expect(page.params).toContain('wger')
    expect(page.sql).toContain('"completed_at" is not null')
    const setsWhere = new PgDialect().sqlToQuery(whereArgs[1] as SQL)
    expect(setsWhere.params).toContain(42)
    expect(setsWhere.params).toContain('wger')
  })

  it('clamps limit and offset at the module boundary', async () => {
    selectResults = [[]]

    await getExerciseSessions(USER, 'wger', 42, { limit: 500, offset: -5 })

    expect(limitArgs).toEqual([50])
    expect(offsetArgs).toEqual([0])
  })

  it('normalizes non-finite limit and offset instead of passing them through', async () => {
    selectResults = [[]]

    await getExerciseSessions(USER, 'wger', 42, { limit: NaN, offset: Infinity })

    expect(limitArgs).toEqual([50])
    expect(offsetArgs).toEqual([0])
  })

  it('skips the set query entirely for an empty page', async () => {
    selectResults = [[]]

    const sessions = await getExerciseSessions(USER, 'wger', 42, { limit: 10, offset: 0 })

    expect(sessions).toEqual([])
    expect(selectCount).toBe(1)
  })
})

describe('aggregateLoggedExercises', () => {
  /** One occurrence row; overrides on top of a wger default. */
  function occ(over: Partial<LoggedExerciseRow> = {}): LoggedExerciseRow {
    return {
      wgerExerciseId: 42,
      source: 'wger',
      name: 'Bench Press',
      workoutId: 'w1',
      startedAt: S1,
      ...over,
    }
  }

  it('keeps a custom exercise separate from a wger exercise with the same id', () => {
    const rows = [
      occ({ source: 'wger', name: 'Bench Press' }),
      occ({ source: 'custom', name: 'My Bench', workoutId: 'w2', startedAt: S2 }),
    ]

    const entries = aggregateLoggedExercises(rows)

    expect(entries).toHaveLength(2)
    expect(entries.map((e) => `${e.source}:${e.wgerExerciseId}`).sort()).toEqual([
      'custom:42',
      'wger:42',
    ])
  })

  it('lets the latest denormalized name win and counts distinct sessions', () => {
    const rows = [
      occ({ workoutId: 'w1', startedAt: S1, name: 'Bench Press' }),
      // Same exercise twice within one workout (two slots) — one session.
      occ({ workoutId: 'w1', startedAt: S1, name: 'Bench Press' }),
      occ({ workoutId: 'w2', startedAt: S2, name: 'Comp Bench' }),
    ]

    const entries = aggregateLoggedExercises(rows)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      name: 'Comp Bench',
      sessionCount: 2,
      lastPerformedAt: S2,
    })
  })

  it('orders entries newest-trained first', () => {
    const rows = [
      occ({ wgerExerciseId: 1, name: 'Squat', workoutId: 'w1', startedAt: S1 }),
      occ({ wgerExerciseId: 2, name: 'Deadlift', workoutId: 'w3', startedAt: S3 }),
      occ({ wgerExerciseId: 3, name: 'Row', workoutId: 'w2', startedAt: S2 }),
    ]

    const entries = aggregateLoggedExercises(rows)

    expect(entries.map((e) => e.name)).toEqual(['Deadlift', 'Row', 'Squat'])
  })

  it('returns an empty list for no history', () => {
    expect(aggregateLoggedExercises([])).toEqual([])
  })
})

describe('listLoggedExercises', () => {
  it('scopes the query to the user and completed workouts', async () => {
    selectResults = [
      [
        {
          wgerExerciseId: 42,
          source: 'wger',
          name: 'Bench Press',
          workoutId: 'w1',
          startedAt: S1,
        },
      ],
    ]

    const entries = await listLoggedExercises(USER)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ wgerExerciseId: 42, sessionCount: 1 })
    const where = new PgDialect().sqlToQuery(whereArgs[0] as SQL)
    expect(where.params).toContain(USER)
    expect(where.sql).toContain('"completed_at" is not null')
  })
})
