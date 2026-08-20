import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * Mocked-db harness (muscle-volume.test.ts recipe): each `db.select()`
 * dequeues the next queued row-array; where-conditions are captured for
 * PgDialect introspection. The active-program lookup adds orderBy/limit to
 * the builder chain.
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
    orderBy: () => builder,
    limit: () => builder,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }
  return builder
}

vi.mock('./index', () => ({
  db: { select: () => makeBuilder() },
}))

import {
  aggregatePlannedVolume,
  getPlannedWeeklyVolume,
  type PlannedMuscleRow,
  type PlannedSetRow,
} from './planned-volume'

const USER = 'user_123'

/** One planned set; overrides on top of a reps_weight working-set default. */
function set(over: Partial<PlannedSetRow> = {}): PlannedSetRow {
  return { programExerciseId: 'pe1', setType: 'working', metricMode: 'reps_weight', ...over }
}

/** Bench-like tags for pe1: Chest primary, Triceps+Shoulders secondary. */
const BENCH_TAGS: PlannedMuscleRow[] = [
  { programExerciseId: 'pe1', muscle: 'Chest', role: 'primary' },
  { programExerciseId: 'pe1', muscle: 'Triceps', role: 'secondary' },
  { programExerciseId: 'pe1', muscle: 'Shoulders', role: 'secondary' },
]

function byGroup(volume: ReturnType<typeof aggregatePlannedVolume>): Record<string, number> {
  return Object.fromEntries(volume.groups.map((g) => [g.group, g.plannedSets]))
}

beforeEach(() => {
  selectResults = []
  whereArgs.length = 0
})

describe('aggregatePlannedVolume', () => {
  it('credits primaries 1.0 and secondaries 0.5 per planned set (performed-side mirror)', () => {
    const volume = aggregatePlannedVolume([set(), set()], BENCH_TAGS)

    const groups = byGroup(volume)
    expect(groups.Chest).toBe(2)
    expect(groups.Triceps).toBe(1)
    expect(groups.Shoulders).toBe(1)
    expect(groups.Back).toBe(0)
    expect(volume.totalSets).toBe(2)
  })

  it('counts a group tagged both primary and secondary once at 1.0', () => {
    // Chest primary + Serratus anterior secondary — same Chest bucket.
    const tags: PlannedMuscleRow[] = [
      { programExerciseId: 'pe1', muscle: 'Chest', role: 'primary' },
      { programExerciseId: 'pe1', muscle: 'Serratus anterior', role: 'secondary' },
    ]

    expect(byGroup(aggregatePlannedVolume([set()], tags)).Chest).toBe(1)
  })

  it('counts a prescribed technique set the way the logged rows will count', () => {
    // Two mini-sets after the top set: 1 + 0.5 + 0.5 = 2 hard sets, exactly
    // what db/muscle-volume.ts credits once the stages are logged as rows.
    const restPause = set({
      technique: {
        version: 1,
        kind: 'rest-pause',
        stages: [{ reps: 3 }, { reps: 2 }],
      },
    })

    const volume = aggregatePlannedVolume([restPause], BENCH_TAGS)

    expect(volume.totalSets).toBe(2)
    expect(byGroup(volume).Chest).toBe(2)
  })

  it('counts a prescribed cluster as one set however many blocks it names', () => {
    const cluster = set({
      technique: {
        version: 1,
        kind: 'cluster',
        stages: [{ reps: 2, restSec: 20 }, { reps: 2, restSec: 20 }],
      },
    })

    expect(aggregatePlannedVolume([cluster], BENCH_TAGS).totalSets).toBe(1)
  })

  it('excludes warmup prescriptions but counts working, backoff, and amrap', () => {
    const rows = [
      set({ setType: 'warmup' }),
      set({ setType: 'working' }),
      set({ setType: 'backoff' }),
      set({ setType: 'amrap' }),
    ]

    const volume = aggregatePlannedVolume(rows, BENCH_TAGS)

    expect(volume.totalSets).toBe(3)
    expect(byGroup(volume).Chest).toBe(3)
  })

  it('excludes duration-mode planned sets (reps_weight is the volume unit)', () => {
    const volume = aggregatePlannedVolume([set({ metricMode: 'duration' }), set()], BENCH_TAGS)

    expect(volume.totalSets).toBe(1)
    expect(byGroup(volume).Chest).toBe(1)
  })

  it("lands untagged exercises and unmapped muscle names in 'Other'", () => {
    const rows = [set({ programExerciseId: 'untagged' }), set({ programExerciseId: 'pe2' })]
    const tags: PlannedMuscleRow[] = [
      { programExerciseId: 'pe2', muscle: 'Mystery Muscle', role: 'primary' },
    ]

    const volume = aggregatePlannedVolume(rows, tags)

    expect(byGroup(volume).Other).toBe(2)
  })

  it("returns all ten groups in order and appends 'Other' only when planned", () => {
    const clean = aggregatePlannedVolume([set()], BENCH_TAGS)
    expect(clean.groups).toHaveLength(10)
    expect(clean.groups[0].group).toBe('Chest')

    const withOther = aggregatePlannedVolume([set({ programExerciseId: 'untagged' })], [])
    expect(withOther.groups).toHaveLength(11)
    expect(withOther.groups[10]).toEqual({ group: 'Other', plannedSets: 1 })
  })

  it('returns empty targets for an empty program', () => {
    const volume = aggregatePlannedVolume([], [])

    expect(volume.totalSets).toBe(0)
    expect(volume.groups.every((g) => g.plannedSets === 0)).toBe(true)
  })

  it('does not mutate its inputs', () => {
    const rows = [set()]
    const tags = [...BENCH_TAGS]
    const rowsSnapshot = structuredClone(rows)
    const tagsSnapshot = structuredClone(tags)

    aggregatePlannedVolume(rows, tags)

    expect(rows).toEqual(rowsSnapshot)
    expect(tags).toEqual(tagsSnapshot)
  })
})

describe('getPlannedWeeklyVolume', () => {
  it('returns null when the user has no active program', async () => {
    selectResults = [[]]

    expect(await getPlannedWeeklyVolume(USER)).toBeNull()
    // Only the program lookup ran — no set/muscle fetches.
    expect(whereArgs).toHaveLength(1)
  })

  it("scopes the lookup to the user's active programs and the children to the program", async () => {
    selectResults = [
      [{ id: 'prog-1', name: 'PPL' }],
      [set(), set({ setType: 'warmup' })],
      BENCH_TAGS as unknown[],
    ]

    const planned = await getPlannedWeeklyVolume(USER)

    expect(planned).not.toBeNull()
    expect(planned!.programId).toBe('prog-1')
    expect(planned!.programName).toBe('PPL')
    expect(planned!.totalSets).toBe(1) // the warmup never counts
    expect(planned!.groups.find((g) => g.group === 'Chest')!.plannedSets).toBe(1)

    const dialect = new PgDialect()
    const programWhere = dialect.sqlToQuery(whereArgs[0] as SQL)
    expect(programWhere.params).toContain(USER)
    expect(programWhere.params).toContain('active')
    // Both child queries are scoped to the found program's id.
    expect(dialect.sqlToQuery(whereArgs[1] as SQL).params).toContain('prog-1')
    expect(dialect.sqlToQuery(whereArgs[2] as SQL).params).toContain('prog-1')
  })
})
