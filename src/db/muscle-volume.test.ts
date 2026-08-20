import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { volumeWindows } from '@/lib/volume-window'

/**
 * Mocked-db harness (program-stats.test.ts recipe): each `db.select()`
 * dequeues the next queued row-array; the where-condition is captured for
 * PgDialect introspection. The catalog and customs reads are mocked so the
 * resolver is deterministic and the select queue stays this module's own.
 */
let selectResults: unknown[][] = []
const whereArgs: unknown[] = []

function makeBuilder() {
  const rows = selectResults.shift() ?? []
  const builder: Record<string, unknown> = {
    from: () => builder,
    innerJoin: () => builder,
    where: (cond: unknown) => {
      whereArgs.push(cond)
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
vi.mock('@/lib/wger', () => ({
  getAllExercises: vi.fn(async () => [
    {
      id: 1,
      name: 'Bench Press',
      category: 'Chest',
      muscles: ['Chest'],
      musclesSecondary: ['Triceps', 'Shoulders'],
    },
    { id: 2, name: 'Mystery Machine', category: 'Legs' }, // no muscles listed
  ]),
}))
vi.mock('./custom-exercises', () => ({
  listCustomExercises: vi.fn(async () => [
    { id: 1, name: 'My Row', muscles: ['Lats'], musclesSecondary: ['Biceps'] },
    // DB default: nullable text arrays — the resolver must read these as
    // empty, not unknown.
    { id: 2, name: 'Bare Custom', muscles: null, musclesSecondary: null },
  ]),
}))

import {
  aggregateMuscleVolume,
  buildMuscleResolver,
  getMuscleVolume,
  getVolumeTotals,
  type MuscleVolumeRow,
} from './muscle-volume'
import { getAllExercises } from '@/lib/wger'

const USER = 'user_123'
const NOW = new Date('2026-07-15T18:00:00Z')
const WINDOWS = volumeWindows('rolling', NOW)
const IN_CURRENT = new Date('2026-07-14T10:00:00Z')
const IN_PREVIOUS = new Date('2026-07-05T10:00:00Z')
const TOO_OLD = new Date('2026-06-01T10:00:00Z')

/** One completed-set row; overrides on top of a current-window wger default. */
function row(over: Partial<MuscleVolumeRow> = {}): MuscleVolumeRow {
  return {
    workoutId: 'w1',
    startedAt: IN_CURRENT,
    wgerExerciseId: 1,
    source: 'wger',
    metricMode: 'reps_weight',
    ...over,
  }
}

/** Bench-like resolver: Chest primary, Triceps+Shoulders secondary. */
const BENCH_RESOLVER = () => ({ primary: ['Chest'], secondary: ['Triceps', 'Shoulders'] })

beforeEach(() => {
  selectResults = []
  whereArgs.length = 0
})

describe('aggregateMuscleVolume', () => {
  it('credits primaries 1.0 and secondaries 0.5 per set', () => {
    const volume = aggregateMuscleVolume([row(), row()], BENCH_RESOLVER, WINDOWS)

    const byGroup = Object.fromEntries(volume.groups.map((g) => [g.group, g.currentSets]))
    expect(byGroup.Chest).toBe(2)
    expect(byGroup.Triceps).toBe(1)
    expect(byGroup.Shoulders).toBe(1)
    expect(byGroup.Back).toBe(0)
    expect(volume.totals.currentSets).toBe(2)
  })

  it('counts a group listed as both primary and secondary once at 1.0', () => {
    // Chest primary + Serratus anterior secondary — same Chest bucket.
    const resolver = () => ({ primary: ['Chest'], secondary: ['Serratus anterior'] })

    const volume = aggregateMuscleVolume([row()], resolver, WINDOWS)

    expect(volume.groups.find((g) => g.group === 'Chest')!.currentSets).toBe(1)
  })

  it('splits rows across current and previous windows, edges honest', () => {
    const rows = [
      row({ startedAt: IN_CURRENT }),
      row({ workoutId: 'w2', startedAt: IN_PREVIOUS }),
      row({ workoutId: 'w3', startedAt: WINDOWS.previous.start }), // inclusive start
      row({ workoutId: 'w4', startedAt: TOO_OLD }), // over-fetch tolerance
    ]

    const volume = aggregateMuscleVolume(rows, BENCH_RESOLVER, WINDOWS)

    expect(volume.totals.currentSets).toBe(1)
    expect(volume.totals.previousSets).toBe(2)
    const chest = volume.groups.find((g) => g.group === 'Chest')!
    expect(chest.currentSets).toBe(1)
    expect(chest.previousSets).toBe(2)
  })

  it('routes unknown exercises to Other', () => {
    const rows = [row(), row({ workoutId: 'w2' })]
    const resolver = () => null

    const volume = aggregateMuscleVolume(rows, resolver, WINDOWS)

    const other = volume.groups.find((g) => g.group === 'Other')
    expect(other?.currentSets).toBe(2)
  })

  it('routes unmapped muscle NAMES to Other without losing mapped ones', () => {
    const resolver = () => ({ primary: ['Forearm flexors'], secondary: ['Biceps'] })

    const volume = aggregateMuscleVolume([row()], resolver, WINDOWS)

    expect(volume.groups.find((g) => g.group === 'Other')?.currentSets).toBe(1)
    expect(volume.groups.find((g) => g.group === 'Biceps')!.currentSets).toBe(0.5)
  })

  it('counts a clock-skewed future startedAt as current, never dropped', () => {
    // Client/server skew: a just-logged session can carry a startedAt a few
    // minutes past the server's now (recent-window.ts documents this).
    const skewed = new Date(NOW.getTime() + 5 * 60 * 1000)

    const volume = aggregateMuscleVolume([row({ startedAt: skewed })], BENCH_RESOLVER, WINDOWS)

    expect(volume.totals.currentSets).toBe(1)
    expect(volume.groups.find((g) => g.group === 'Chest')!.currentSets).toBe(1)
  })

  it('never counts duration-mode rows', () => {
    const volume = aggregateMuscleVolume(
      [row({ metricMode: 'duration' })],
      BENCH_RESOLVER,
      WINDOWS,
    )

    expect(volume.totals.currentSets).toBe(0)
    expect(volume.groups.every((g) => g.currentSets === 0)).toBe(true)
  })

  it('omits Other entirely when empty and keeps all ten groups otherwise', () => {
    const volume = aggregateMuscleVolume([row()], BENCH_RESOLVER, WINDOWS)

    expect(volume.groups).toHaveLength(10)
    expect(volume.groups.some((g) => g.group === 'Other')).toBe(false)
  })

  it('counts distinct current-window sessions', () => {
    const rows = [row(), row(), row({ workoutId: 'w2' })]

    const volume = aggregateMuscleVolume(rows, BENCH_RESOLVER, WINDOWS)

    expect(volume.totals.currentSessions).toBe(2)
  })

  it('does not mutate its inputs', () => {
    const rows = [row()]
    const snapshot = structuredClone(rows)

    aggregateMuscleVolume(rows, BENCH_RESOLVER, WINDOWS)

    expect(rows).toEqual(snapshot)
  })
})

describe('technique groups count as hard sets, not as rows', () => {
  const stage = (kind: string, stageIndex: number) =>
    row({ techniqueKind: kind, stageIndex })

  it('counts a 3-row rest-pause as 2 sets (top set + two half-credit stages)', () => {
    const volume = aggregateMuscleVolume(
      [stage('rest-pause', 0), stage('rest-pause', 1), stage('rest-pause', 2)],
      BENCH_RESOLVER,
      WINDOWS,
    )

    expect(volume.totals.currentSets).toBe(2)
    expect(volume.groups.find((g) => g.group === 'Chest')!.currentSets).toBe(2)
    // Secondaries scale with the same weight — 0.5 credit × 2 hard sets.
    expect(volume.groups.find((g) => g.group === 'Triceps')!.currentSets).toBe(1)
  })

  it('counts a cluster as exactly one set however many blocks it has', () => {
    const volume = aggregateMuscleVolume(
      [stage('cluster', 0), stage('cluster', 1), stage('cluster', 2)],
      BENCH_RESOLVER,
      WINDOWS,
    )

    expect(volume.totals.currentSets).toBe(1)
    expect(volume.groups.find((g) => g.group === 'Chest')!.currentSets).toBe(1)
  })

  it('leaves ordinary sets at 1.0 and degrades a junk kind to ordinary', () => {
    const volume = aggregateMuscleVolume(
      [row(), row({ techniqueKind: 'giant-set', stageIndex: 1 })],
      BENCH_RESOLVER,
      WINDOWS,
    )

    expect(volume.totals.currentSets).toBe(2)
  })

  it('weights the previous window the same way (the comparison stays honest)', () => {
    const volume = aggregateMuscleVolume(
      [
        row({ startedAt: IN_PREVIOUS, techniqueKind: 'drop-set', stageIndex: 0 }),
        row({ startedAt: IN_PREVIOUS, techniqueKind: 'drop-set', stageIndex: 1 }),
      ],
      BENCH_RESOLVER,
      WINDOWS,
    )

    expect(volume.totals.previousSets).toBe(1.5)
  })
})

describe('buildMuscleResolver', () => {
  it('keys wger and custom identities separately', async () => {
    const resolver = await buildMuscleResolver(USER)

    // wger id 1 = Bench; custom id 1 = My Row — same number, different worlds.
    expect(resolver('wger', 1)).toEqual({
      primary: ['Chest'],
      secondary: ['Triceps', 'Shoulders'],
    })
    expect(resolver('custom', 1)).toEqual({ primary: ['Lats'], secondary: ['Biceps'] })
    expect(resolver('wger', 999)).toBeNull()
  })

  it('treats a catalog entry without muscle lists as empty (not unknown)', async () => {
    const resolver = await buildMuscleResolver(USER)

    expect(resolver('wger', 2)).toEqual({ primary: [], secondary: [] })
    // Customs store nullable arrays — same empty-not-unknown reading.
    expect(resolver('custom', 2)).toEqual({ primary: [], secondary: [] })
  })
})

describe('getVolumeTotals', () => {
  it('returns totals without ever touching the catalog', async () => {
    selectResults = [[row(), row({ workoutId: 'w2', startedAt: IN_PREVIOUS })]]
    vi.mocked(getAllExercises).mockClear()

    const totals = await getVolumeTotals(USER, WINDOWS)

    expect(totals).toEqual({
      currentSets: 1,
      previousSets: 1,
      currentSessions: 1,
      currentCardioSec: 0,
      previousCardioSec: 0,
    })
    // The home teaser's guarantee: no wger catalog on its critical path.
    expect(getAllExercises).not.toHaveBeenCalled()
  })
})

describe('getMuscleVolume', () => {
  it('scopes the query to the user, completed workouts, completed sets, and the horizon', async () => {
    selectResults = [[row()]]

    const volume = await getMuscleVolume(USER, WINDOWS)

    expect(volume.totals.currentSets).toBe(1)
    const where = new PgDialect().sqlToQuery(whereArgs[0] as SQL)
    expect(where.params).toContain(USER)
    expect(where.params).toContain(true) // sets.completed = true
    // Drizzle serializes Date params to ISO strings at the dialect layer.
    expect(where.params).toContain(WINDOWS.previous.start.toISOString())
    expect(where.sql).toContain('"completed_at" is not null')
  })
})

describe('weekly cardio seconds (cardio v1 slice 3)', () => {
  it('sums completed duration-set seconds per window, apart from set counts', () => {
    const rows = [
      row(), // lifting set — counts as a set, no cardio seconds
      row({ metricMode: 'duration_distance', durationSec: 1800 }),
      row({ metricMode: 'duration', durationSec: 600 }),
      row({ workoutId: 'w2', startedAt: IN_PREVIOUS, metricMode: 'duration', durationSec: 900 }),
      // Over-fetch tolerance: outside both windows → never counted.
      row({ workoutId: 'w3', startedAt: TOO_OLD, metricMode: 'duration', durationSec: 999 }),
    ]

    const volume = aggregateMuscleVolume(rows, BENCH_RESOLVER, WINDOWS)

    expect(volume.totals.currentCardioSec).toBe(2400)
    expect(volume.totals.previousCardioSec).toBe(900)
    // Duration rows still never count as sets or muscle credits.
    expect(volume.totals.currentSets).toBe(1)
    expect(volume.groups.find((g) => g.group === 'Chest')!.currentSets).toBe(1)
  })

  it('reports zero cardio seconds for a lifting-only horizon', () => {
    const volume = aggregateMuscleVolume([row()], BENCH_RESOLVER, WINDOWS)
    expect(volume.totals.currentCardioSec).toBe(0)
    expect(volume.totals.previousCardioSec).toBe(0)
  })
})
