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

// The program's current week — a workout-history read this aggregate has no
// business re-deriving. Stubbed so the select queue stays the module's own.
const { programWeekState } = vi.hoisted(() => ({ programWeekState: vi.fn() }))
vi.mock('./programs', () => ({ programWeekState }))

import type { ProgramSetRowLike } from '@/lib/programs/progression'
import type { Progression } from '@/lib/programs/program-input'
import {
  aggregatePlannedVolume,
  derivePlannedSetRows,
  getPlannedWeeklyVolume,
  type PlannedExercisePlan,
  type PlannedMuscleRow,
  type PlannedSetRow,
} from './planned-volume'

const USER = 'user_123'

/** One planned set; overrides on top of a reps_weight working-set default. */
function set(over: Partial<PlannedSetRow> = {}): PlannedSetRow {
  return { programExerciseId: 'pe1', setType: 'working', metricMode: 'reps_weight', ...over }
}

/** One STORED plan row, as `getPlannedWeeklyVolume`'s query projects it.
 *  Typed against the real row shape (not `Record<string, unknown>`) so the
 *  literal set/metric modes stay literal — a widened `string` here is what
 *  used to force a bridge cast at the call sites, which would have swallowed
 *  any future required field on `ProgramSetRowLike`. */
function planRow(
  over: Partial<ProgramSetRowLike & { programExerciseId: string; progression: Progression | null; id: string }> = {},
): ProgramSetRowLike & { programExerciseId: string; progression: Progression | null; id: string } {
  return {
    programExerciseId: 'pe1',
    progression: null,
    id: 'ps1',
    setNumber: 1,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: 8,
    repMax: 12,
    rir: null,
    rpe: null,
    suggestedLoadKg: 100,
    tempo: null,
    durationSec: null,
    distanceM: null,
    restSec: null,
    technique: null,
    ...over,
  }
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
  programWeekState.mockReset()
  programWeekState.mockResolvedValue({ currentWeek: 1, blockComplete: false })
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
      [{ id: 'prog-1', name: 'PPL', mesocycleWeeks: 4, deloadWeek: null, deloadPolicy: null }],
      [planRow(), planRow({ id: 'ps2', setNumber: 2, setType: 'warmup' })],
      [], // no per-week overrides
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
    // Every child query is scoped to the found program's id.
    expect(dialect.sqlToQuery(whereArgs[1] as SQL).params).toContain('prog-1')
    expect(dialect.sqlToQuery(whereArgs[2] as SQL).params).toContain('prog-1')
    expect(dialect.sqlToQuery(whereArgs[3] as SQL).params).toContain('prog-1')
  })

  /**
   * The regression this rewrite exists for. The target used to be a count of
   * the stored `program_sets` rows, so a scheduled deload halved what the
   * lifter performed while the target it was compared against stayed at full
   * volume — a shortfall on /stats that nobody earned.
   */
  it('counts the DELOAD week at the policy setFactor, not the stored row count', async () => {
    // Arrange — 4 working sets, week 4 is a scheduled deload at setFactor 0.5.
    selectResults = [
      [
        {
          id: 'prog-1',
          name: 'PPL',
          mesocycleWeeks: 4,
          deloadWeek: 4,
          deloadPolicy: {
            mode: 'scheduled',
            shape: { loadFactor: 0.85, setFactor: 0.5, rpeCap: null, timedExercises: 'untouched' },
          },
        },
      ],
      [1, 2, 3, 4].map((n) => planRow({ id: `ps${n}`, setNumber: n })),
      [],
      BENCH_TAGS as unknown[],
    ]
    programWeekState.mockResolvedValue({ currentWeek: 4, blockComplete: false })

    // Act
    const planned = await getPlannedWeeklyVolume(USER)

    // Assert — the deload week prescribes 2 sets, so 2 is the target.
    expect(planned!.totalSets).toBe(2)
    expect(planned!.groups.find((g) => g.group === 'Chest')!.plannedSets).toBe(2)
  })

  it('counts a non-deload week at full volume under the same policy', async () => {
    selectResults = [
      [
        {
          id: 'prog-1',
          name: 'PPL',
          mesocycleWeeks: 4,
          deloadWeek: 4,
          deloadPolicy: {
            mode: 'scheduled',
            shape: { loadFactor: 0.85, setFactor: 0.5, rpeCap: null, timedExercises: 'untouched' },
          },
        },
      ],
      [1, 2, 3, 4].map((n) => planRow({ id: `ps${n}`, setNumber: n })),
      [],
      BENCH_TAGS as unknown[],
    ]
    programWeekState.mockResolvedValue({ currentWeek: 3, blockComplete: false })

    expect((await getPlannedWeeklyVolume(USER))!.totalSets).toBe(4)
  })

  it("honors a per-week technique override — the week's dose, not the template's", async () => {
    // Arrange — a plain set the owner turned into a 2-stage drop set for
    // week 2 only. Hard-set weight 1 + 0.5×2 = 2.
    selectResults = [
      [{ id: 'prog-1', name: 'PPL', mesocycleWeeks: 4, deloadWeek: null, deloadPolicy: null }],
      [planRow()],
      [
        {
          programSetId: 'ps1',
          week: 2,
          repMin: null,
          repMax: null,
          rir: null,
          rpe: null,
          suggestedLoadKg: null,
          tempo: null,
          durationSec: null,
          distanceM: null,
          restSec: null,
          technique: {
            version: 1,
            kind: 'drop-set',
            stages: [{ loadPct: 0.8 }, { loadPct: 0.6 }],
          },
        },
      ],
      BENCH_TAGS as unknown[],
    ]
    programWeekState.mockResolvedValue({ currentWeek: 2, blockComplete: false })

    // Act
    const planned = await getPlannedWeeklyVolume(USER)

    // Assert
    expect(planned!.totalSets).toBe(2)
  })

  it('ignores an override addressed to a different week', async () => {
    selectResults = [
      [{ id: 'prog-1', name: 'PPL', mesocycleWeeks: 4, deloadWeek: null, deloadPolicy: null }],
      [planRow()],
      [
        {
          programSetId: 'ps1',
          week: 3, // not the current week
          repMin: null,
          repMax: null,
          rir: null,
          rpe: null,
          suggestedLoadKg: null,
          tempo: null,
          durationSec: null,
          distanceM: null,
          restSec: null,
          technique: {
            version: 1,
            kind: 'drop-set',
            stages: [{ loadPct: 0.8 }, { loadPct: 0.6 }],
          },
        },
      ],
      BENCH_TAGS as unknown[],
    ]
    programWeekState.mockResolvedValue({ currentWeek: 2, blockComplete: false })

    expect((await getPlannedWeeklyVolume(USER))!.totalSets).toBe(1)
  })
})

describe('derivePlannedSetRows (the shared week derivation)', () => {
  function plan(over: Partial<PlannedExercisePlan> = {}): PlannedExercisePlan {
    return {
      programExerciseId: 'pe1',
      progression: null,
      sets: [{ ...planRow(), overrides: [] }],
      ...over,
    }
  }

  it('counts the weekly-volume ramp at the week it is actually on', () => {
    // Arrange — a ramp from MEV 3 to MRV 6 working sets across a 4-week block.
    const sets = [1, 2, 3].map((n) => ({ ...planRow({ id: `ps${n}`, setNumber: n }), overrides: [] }))
    const ramped = plan({
      progression: { scheme: 'weekly-volume', mevSets: 3, mrvSets: 6 },
      sets,
    })
    const context = {
      mesocycleWeeks: 4,
      deloadWeek: null,
      deloadPolicy: { mode: 'none' } as const,
    }

    // Act
    const week1 = derivePlannedSetRows([ramped], { ...context, week: 1 })
    const week4 = derivePlannedSetRows([ramped], { ...context, week: 4 })

    // Assert — the target grows with the plan instead of sitting at the
    // stored row count for the whole block.
    expect(week1).toHaveLength(3)
    expect(week4.length).toBeGreaterThan(week1.length)
  })

  it('is pure — it never mutates the plans it is given', () => {
    const plans = [plan()]
    const snapshot = structuredClone(plans)

    derivePlannedSetRows(plans, {
      week: 1,
      mesocycleWeeks: 4,
      deloadWeek: null,
      deloadPolicy: { mode: 'none' },
    })

    expect(plans).toEqual(snapshot)
  })
})
