import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * Mocked-db harness for the multi-select `getProgramStats`, mirroring
 * last-performance.test.ts: each `db.select()` dequeues the next queued
 * row-array; the builder is chainable and thenable (this module's chains end
 * at `.where()` or `.orderBy()`). Every where-condition is captured so the
 * user/program scoping can be asserted via PgDialect param introspection.
 * `nextProgramWeek` is mocked out so the test controls `currentWeek` without
 * queueing that function's internal selects.
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
vi.mock('./programs', () => ({
  nextProgramWeek: vi.fn(async () => 2),
}))

import {
  aggregateProgramStats,
  getProgramStats,
  type ProgramStatsRow,
  type ProgramStats,
} from './program-stats'
import { nextProgramWeek } from './programs'

const USER = 'user_123'

const PROGRAM: ProgramStats['program'] = {
  id: 'p1',
  name: 'Upper/Lower + PPL',
  status: 'active',
  mesocycleWeeks: 7,
  deloadWeek: null,
}

/** One flat query row; overrides on top of an empty-workout default. */
function row(over: Partial<ProgramStatsRow> = {}): ProgramStatsRow {
  return {
    workoutId: 'w1',
    programDayId: 'd1',
    programWeek: 1,
    completedAt: null,
    wgerExerciseId: null,
    source: over.wgerExerciseId != null ? 'wger' : null,
    exerciseName: null,
    reps: null,
    weight: null,
    completed: null,
    metricMode: null,
    ...over,
  }
}

const DONE = new Date('2026-07-06T18:00:00Z')

beforeEach(() => {
  selectResults = []
  selectCount = 0
  whereArgs.length = 0
  vi.mocked(nextProgramWeek).mockClear()
})

describe('aggregateProgramStats', () => {
  it('materializes a zeroed week per mesocycle week for an empty block', () => {
    const stats = aggregateProgramStats(PROGRAM, 5, 1, [])

    expect(stats.weeks).toHaveLength(7)
    expect(stats.weeks[0]).toEqual({
      week: 1,
      daysStarted: 0,
      daysCompleted: 0,
      plannedDays: 5,
      completedSets: 0,
      tonnageKg: 0,
    })
    expect(stats.weeks[6].week).toBe(7)
    expect(stats.exercises).toEqual([])
    expect(stats.currentWeek).toBe(1)
    expect(stats.program).toEqual(PROGRAM)
  })

  it('counts adherence, completed sets, and tonnage for a single week', () => {
    const rows = [
      // Day d1: completed workout, two completed bench sets (8×100, 6×100 kg)
      row({ workoutId: 'w1', programDayId: 'd1', completedAt: DONE, wgerExerciseId: 73, exerciseName: 'Bench Press', reps: 8, weight: 100, completed: true, metricMode: 'reps_weight' }),
      row({ workoutId: 'w1', programDayId: 'd1', completedAt: DONE, wgerExerciseId: 73, exerciseName: 'Bench Press', reps: 6, weight: 100, completed: true, metricMode: 'reps_weight' }),
      // Day d2: started but NOT completed; one completed set (5×60 kg)
      row({ workoutId: 'w2', programDayId: 'd2', wgerExerciseId: 191, exerciseName: 'Squat', reps: 5, weight: 60, completed: true, metricMode: 'reps_weight' }),
    ]

    const stats = aggregateProgramStats(PROGRAM, 5, 1, rows)

    expect(stats.weeks[0]).toEqual({
      week: 1,
      daysStarted: 2,
      daysCompleted: 1,
      plannedDays: 5,
      completedSets: 3,
      tonnageKg: 8 * 100 + 6 * 100 + 5 * 60,
    })
  })

  it('tracks per-exercise weekly best e1RM across weeks, ordered by first appearance', () => {
    const rows = [
      row({ workoutId: 'w1', programDayId: 'd1', programWeek: 1, completedAt: DONE, wgerExerciseId: 73, exerciseName: 'Bench Press', reps: 8, weight: 100, completed: true, metricMode: 'reps_weight' }),
      row({ workoutId: 'w2', programDayId: 'd1', programWeek: 2, completedAt: DONE, wgerExerciseId: 73, exerciseName: 'Bench Press', reps: 8, weight: 102.5, completed: true, metricMode: 'reps_weight' }),
      // Squat first appears in week 2 → ordered after bench
      row({ workoutId: 'w2', programDayId: 'd1', programWeek: 2, completedAt: DONE, wgerExerciseId: 191, exerciseName: 'Squat', reps: 5, weight: 140, completed: true, metricMode: 'reps_weight' }),
    ]

    const stats = aggregateProgramStats(PROGRAM, 5, 2, rows)

    expect(stats.exercises.map((e) => e.name)).toEqual(['Bench Press', 'Squat'])
    const bench = stats.exercises[0]
    expect(bench.wgerExerciseId).toBe(73)
    expect(bench.weeks).toHaveLength(2)
    expect(bench.weeks[0]).toMatchObject({ week: 1, completedSets: 1 })
    expect(bench.weeks[0].best).toMatchObject({ reps: 8, weightKg: 100 })
    expect(bench.weeks[1].best).toMatchObject({ reps: 8, weightKg: 102.5 })
    // Rising e1RM, full precision (Epley: w × (1 + reps/30)) — no rounding here
    expect(bench.weeks[0].best?.e1rm).toBeCloseTo(100 * (1 + 8 / 30), 10)
    expect(bench.weeks[1].best!.e1rm).toBeGreaterThan(bench.weeks[0].best!.e1rm)
  })

  it('counts null-weight machine sets in completedSets but not tonnage, with null best', () => {
    // Maxed stack machine: reps logged, weight unknowable → null
    const rows = [
      row({ completedAt: DONE, wgerExerciseId: 555, exerciseName: 'Leg Press', reps: 8, weight: null, completed: true, metricMode: 'reps_weight' }),
    ]

    const stats = aggregateProgramStats(PROGRAM, 5, 1, rows)

    expect(stats.weeks[0].completedSets).toBe(1)
    expect(stats.weeks[0].tonnageKg).toBe(0)
    expect(stats.exercises[0].weeks[0]).toEqual({ week: 1, best: null, completedSets: 1 })
  })

  it('ignores uncompleted seeded sets everywhere (instantiated but never logged)', () => {
    // Instantiation seeds weight with reps null and completed false
    const rows = [
      row({ wgerExerciseId: 73, exerciseName: 'Bench Press', reps: null, weight: 100, completed: false, metricMode: 'reps_weight' }),
    ]

    const stats = aggregateProgramStats(PROGRAM, 5, 1, rows)

    expect(stats.weeks[0].completedSets).toBe(0)
    expect(stats.weeks[0].tonnageKg).toBe(0)
    expect(stats.weeks[0].daysStarted).toBe(1) // the workout still counts as started
    expect(stats.exercises[0].weeks[0]).toEqual({ week: 1, best: null, completedSets: 0 })
  })

  it('counts a started-but-empty workout toward daysStarted only', () => {
    // Left join on a workout with no exercises: all exercise/set columns null
    const rows = [row({ completedAt: null })]

    const stats = aggregateProgramStats(PROGRAM, 5, 1, rows)

    expect(stats.weeks[0]).toMatchObject({ daysStarted: 1, daysCompleted: 0, completedSets: 0 })
    expect(stats.exercises).toEqual([])
  })

  it('counts duration-mode sets in completedSets but never tonnage', () => {
    const rows = [
      row({ completedAt: DONE, wgerExerciseId: 999, exerciseName: 'Plank', reps: null, weight: null, completed: true, metricMode: 'duration' }),
    ]

    const stats = aggregateProgramStats(PROGRAM, 5, 1, rows)

    expect(stats.weeks[0].completedSets).toBe(1)
    expect(stats.weeks[0].tonnageKg).toBe(0)
  })

  it('extends the weeks array when observed weeks overshoot the mesocycle', () => {
    const rows = [
      row({ programWeek: 8, completedAt: DONE, wgerExerciseId: 73, exerciseName: 'Bench Press', reps: 5, weight: 100, completed: true, metricMode: 'reps_weight' }),
    ]

    const stats = aggregateProgramStats(PROGRAM, 5, 7, rows)

    expect(stats.weeks).toHaveLength(8)
    expect(stats.weeks[7]).toMatchObject({ week: 8, daysStarted: 1, completedSets: 1 })
  })

  it('skips rows with a null programWeek without crashing', () => {
    const rows = [row({ programWeek: null, completedAt: DONE, completed: true })]

    const stats = aggregateProgramStats(PROGRAM, 5, 1, rows)

    expect(stats.weeks).toHaveLength(7)
    expect(stats.weeks.every((w) => w.daysStarted === 0 && w.completedSets === 0)).toBe(true)
  })

  it('keeps a custom and a wger exercise with the same numeric id as separate series', () => {
    // Exercise identity is the composite (source, id) — schema.ts:51. A custom
    // exercise's identity id can collide with a wger id; they must not merge.
    const rows = [
      row({ completedAt: DONE, wgerExerciseId: 3, source: 'wger', exerciseName: 'Bench Press', reps: 8, weight: 100, completed: true, metricMode: 'reps_weight' }),
      row({ completedAt: DONE, wgerExerciseId: 3, source: 'custom', exerciseName: 'Belt Squat', reps: 8, weight: 120, completed: true, metricMode: 'reps_weight' }),
    ]

    const stats = aggregateProgramStats(PROGRAM, 5, 1, rows)

    expect(stats.exercises).toHaveLength(2)
    expect(stats.exercises[0]).toMatchObject({ wgerExerciseId: 3, source: 'wger', name: 'Bench Press' })
    expect(stats.exercises[1]).toMatchObject({ wgerExerciseId: 3, source: 'custom', name: 'Belt Squat' })
    expect(stats.exercises[0].weeks[0].best).toMatchObject({ weightKg: 100 })
    expect(stats.exercises[1].weeks[0].best).toMatchObject({ weightKg: 120 })
  })

  it('orders by in-week appearance when a later row lowers an exercise\'s first week', () => {
    // startedAt ordering does not guarantee week order: A shows up first in
    // the input but its week-1 appearance comes AFTER B's. Within week 1,
    // B (index 1) precedes A (index 2) → B sorts first.
    const rows = [
      row({ workoutId: 'w2', programWeek: 2, completedAt: DONE, wgerExerciseId: 1, exerciseName: 'A', reps: 5, weight: 100, completed: true, metricMode: 'reps_weight' }),
      row({ workoutId: 'w1', programWeek: 1, completedAt: DONE, wgerExerciseId: 2, exerciseName: 'B', reps: 5, weight: 100, completed: true, metricMode: 'reps_weight' }),
      row({ workoutId: 'w1', programWeek: 1, completedAt: DONE, wgerExerciseId: 1, exerciseName: 'A', reps: 5, weight: 100, completed: true, metricMode: 'reps_weight' }),
    ]

    const stats = aggregateProgramStats(PROGRAM, 5, 2, rows)

    expect(stats.exercises.map((e) => e.name)).toEqual(['B', 'A'])
  })

  it('counts the same program day twice in a week as one started day', () => {
    const rows = [
      row({ workoutId: 'w1', programDayId: 'd1', completedAt: null }),
      row({ workoutId: 'w2', programDayId: 'd1', completedAt: DONE }),
    ]

    const stats = aggregateProgramStats(PROGRAM, 5, 1, rows)

    // Started twice, completed once → the day is both started and completed
    expect(stats.weeks[0]).toMatchObject({ daysStarted: 1, daysCompleted: 1 })
  })
})

describe('getProgramStats (mocked db)', () => {
  const PROGRAM_ROW = {
    id: 'p1',
    name: 'Upper/Lower + PPL',
    status: 'active',
    mesocycleWeeks: 7,
    deloadWeek: null,
  }

  it('returns null (and skips later reads) when the program is missing or not owned', async () => {
    selectResults = [[]] // ownership-gated program read matches nothing

    const result = await getProgramStats(USER, 'p1')

    expect(result).toBeNull()
    expect(selectCount).toBe(1)
    expect(nextProgramWeek).not.toHaveBeenCalled()
  })

  it('assembles ProgramStats from the three reads plus nextProgramWeek', async () => {
    selectResults = [
      [PROGRAM_ROW],
      [{ value: 4 }], // planned days
      [
        row({ completedAt: DONE, wgerExerciseId: 73, exerciseName: 'Bench Press', reps: 8, weight: 100, completed: true, metricMode: 'reps_weight' }),
      ],
    ]

    const result = await getProgramStats(USER, 'p1')

    expect(result).not.toBeNull()
    expect(result!.program).toEqual(PROGRAM_ROW)
    expect(result!.currentWeek).toBe(2) // from mocked nextProgramWeek
    expect(nextProgramWeek).toHaveBeenCalledWith(USER, 'p1', 7)
    expect(result!.weeks).toHaveLength(7)
    expect(result!.weeks[0]).toMatchObject({ daysStarted: 1, daysCompleted: 1, plannedDays: 4, completedSets: 1, tonnageKg: 800 })
    expect(result!.exercises).toHaveLength(1)
  })

  it('scopes the ownership read and the flat-rows read by user and program', async () => {
    selectResults = [[PROGRAM_ROW], [{ value: 4 }], []]

    await getProgramStats(USER, 'p1')

    // Read 1: programs gate — both identifiers present
    const gate = new PgDialect().sqlToQuery(whereArgs[0] as SQL)
    expect(gate.params).toContain(USER)
    expect(gate.params).toContain('p1')
    // Read 3 (flat rows) — the join is program-scoped AND user-scoped so no
    // cross-user workout can leak into stats
    const flat = new PgDialect().sqlToQuery(whereArgs[2] as SQL)
    expect(flat.params).toContain(USER)
    expect(flat.params).toContain('p1')
  })
})
