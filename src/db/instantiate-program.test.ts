import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { DELOAD_LOAD_FACTOR } from '@/lib/progression'

/**
 * Recording stub for the engine-driven instantiateProgramDay.
 * `db.query.programDays.findFirst` returns the fixture day (ownership read);
 * `db.select(...)` chains feed `nextProgramWeek`'s aggregates from
 * `selectQueue` in call order; `db.transaction(cb)` runs `cb(tx)` where
 * `tx.insert(table).values(v).returning()` records `v` and resolves a
 * deterministic id. History reads (`getLastPerformance`,
 * `getExerciseHistoryBefore`) are module-mocked — the engine's history inputs
 * are asserted through the derived seeds.
 *
 * Returned ids by call order: workout → w1, exercise → e1.
 */
const { findFirst, lastPerformance, historyBefore } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  lastPerformance: vi.fn(),
  historyBefore: vi.fn(),
}))

const records: { values: unknown }[] = []
let idCounter = 0
const ID_SEQUENCE = ['w1', 'e1']
let selectQueue: unknown[][] = []

// Where-predicates captured per select, in call order — the harness must be
// able to tell "filters by completedAt" from "doesn't", or a dropped
// isNotNull ships silently (exactly how the merely-started-counts-as-done
// bug got out originally).
let capturedWheres: unknown[] = []

function selectChain() {
  const rows = selectQueue.shift() ?? []
  const obj = {
    from: () => obj,
    innerJoin: () => obj,
    where: (predicate: unknown) => {
      capturedWheres.push(predicate)
      return obj
    },
    orderBy: () => obj,
    limit: () => obj,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
  }
  return obj
}

/** True when a drizzle condition tree references the given column name.
 *  Walks ONLY queryChunks (columns are leaves): descending into a column's
 *  own properties would reach its table's full column list and make every
 *  workouts predicate "mention" every workouts column. */
function predicateMentionsColumn(predicate: unknown, column: string): boolean {
  if (predicate === null || typeof predicate !== 'object') return false
  const p = predicate as { name?: unknown; queryChunks?: unknown[] }
  if (p.name === column) return true
  if (Array.isArray(p.queryChunks)) {
    return p.queryChunks.some((chunk) => predicateMentionsColumn(chunk, column))
  }
  return false
}

function makeTx() {
  return {
    insert: () => ({
      values: (v: unknown) => {
        records.push({ values: v })
        return { returning: () => Promise.resolve([{ id: ID_SEQUENCE[idCounter++] }]) }
      },
    }),
  }
}

vi.mock('./index', () => ({
  db: {
    query: { programDays: { findFirst } },
    select: () => selectChain(),
    selectDistinct: () => selectChain(),
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
  },
}))

vi.mock('./workouts', () => ({
  getLastPerformance: lastPerformance,
  getExerciseHistoryBefore: historyBefore,
}))

import {
  instantiateProgramDay,
  nextProgramWeek,
  programWeekState,
  getNextProgramDay,
} from './programs'

const USER = 'user_123'

interface FixtureSet {
  setNumber: number
  setType?: string
  metricMode?: string
  repMin?: number | null
  repMax?: number | null
  suggestedLoadKg?: number | null
  overrides?: { week: number; [key: string]: unknown }[]
}

/** A one-exercise day under a program with the given geometry. */
function dayFixture(options: {
  mesocycleWeeks?: number
  deloadWeek?: number | null
  progression?: unknown
  source?: 'wger' | 'custom'
  status?: string
  sets: FixtureSet[]
}) {
  return {
    id: 'd1',
    name: 'Push',
    program: {
      id: 'p1',
      userId: USER,
      status: options.status ?? 'active',
      mesocycleWeeks: options.mesocycleWeeks ?? 4,
      deloadWeek: options.deloadWeek ?? null,
    },
    exercises: [
      {
        id: 'pe1',
        wgerExerciseId: 1,
        source: options.source ?? 'wger',
        name: 'Bench',
        position: 0,
        progression: options.progression ?? null,
        sets: options.sets.map((s) => ({
          setType: 'working',
          metricMode: 'reps_weight',
          repMin: null,
          repMax: null,
          rir: null,
          rpe: null,
          suggestedLoadKg: null,
          tempo: null,
          durationSec: null,
          distanceM: null,
          technique: null,
          overrides: [],
          ...s,
        })),
      },
    ],
  }
}

/** The seeded live-set rows (the last recorded insert). */
function seededSets(): { setNumber: number; weight: number | null; metricMode: string }[] {
  return records[records.length - 1].values as never
}

beforeEach(() => {
  records.length = 0
  idCounter = 0
  selectQueue = []
  capturedWheres = []
  vi.clearAllMocks()
  historyBefore.mockResolvedValue([])
  lastPerformance.mockResolvedValue(null)
})

describe('instantiateProgramDay (engine-driven)', () => {
  it('seeds provenance and week-N progressed loads (linear, explicit week)', async () => {
    // Arrange — linear +2.5/week, week 3 → 100 + 2×2.5 = 105
    findFirst.mockResolvedValue(
      dayFixture({
        progression: { scheme: 'linear', incrementKg: 2.5 },
        sets: [
          { setNumber: 1, suggestedLoadKg: 100 },
          { setNumber: 2, metricMode: 'duration', suggestedLoadKg: null },
        ],
      }),
    )

    // Act
    const result = await instantiateProgramDay(USER, 'd1', 3)

    // Assert — provenance stamps the explicit week
    expect(records[0].values).toEqual({
      userId: USER,
      name: 'Push',
      programDayId: 'd1',
      programWeek: 3,
    })
    // reps_weight set carries the DERIVED load; duration set seeds no weight.
    expect(seededSets()).toEqual([
      expect.objectContaining({ setNumber: 1, weight: 105, metricMode: 'reps_weight' }),
      expect.objectContaining({ setNumber: 2, weight: null, metricMode: 'duration' }),
    ])
    expect(result).toEqual({ id: 'w1', week: 3, weekDerived: false })
  })

  it('seeds setType and the prescribed_* snapshot on every set (immutable autoreg facts)', async () => {
    // Arrange — a warmup + working pair; linear +2.5/week at week 2 → 102.5
    findFirst.mockResolvedValue(
      dayFixture({
        progression: { scheme: 'linear', incrementKg: 2.5 },
        sets: [
          { setNumber: 1, setType: 'warmup', repMin: 5, suggestedLoadKg: 60 },
          { setNumber: 2, repMin: 8, suggestedLoadKg: 100 },
        ],
      }),
    )

    // Act
    await instantiateProgramDay(USER, 'd1', 2)

    // Assert — the prescription's role and derived facts travel with the row
    // (the DB default 'working' must never erase a warmup/backoff/amrap, and
    // the snapshot is what the stall rules later score actuals against).
    expect(seededSets()).toEqual([
      expect.objectContaining({
        setNumber: 1,
        setType: 'warmup',
        prescribedLoadKg: 60, // warmups pass through unprogressed
        prescribedRepMin: 5,
      }),
      expect.objectContaining({
        setNumber: 2,
        setType: 'working',
        weight: 102.5,
        prescribedLoadKg: 102.5,
        prescribedRepMin: 8,
      }),
    ])
  })

  it('stamps the workout exercise with the slot source (custom keeps custom history)', async () => {
    // Arrange — a custom slot
    findFirst.mockResolvedValue(
      dayFixture({ source: 'custom', sets: [{ setNumber: 1, suggestedLoadKg: 40 }] }),
    )

    // Act
    await instantiateProgramDay(USER, 'd1', 1)

    // Assert — the seeded workout exercise carries the composite identity
    expect(records[1].values).toMatchObject({ wgerExerciseId: 1, source: 'custom' })
  })

  it('halves the working sets and scales the load on the deload week', async () => {
    // Arrange — 4 working sets @100, deload week 4
    findFirst.mockResolvedValue(
      dayFixture({
        deloadWeek: 4,
        sets: [1, 2, 3, 4].map((n) => ({ setNumber: n, suggestedLoadKg: 100 })),
      }),
    )

    // Act
    await instantiateProgramDay(USER, 'd1', 4)

    // Assert
    const seeded = seededSets()
    expect(seeded).toHaveLength(2)
    expect(seeded[0].weight).toBeCloseTo(100 * DELOAD_LOAD_FACTOR, 5)
  })

  it('lets a per-week override pin the seeded load over the scheme', async () => {
    // Arrange — linear would give 105 at week 3; override pins 95
    findFirst.mockResolvedValue(
      dayFixture({
        progression: { scheme: 'linear', incrementKg: 2.5 },
        sets: [
          {
            setNumber: 1,
            suggestedLoadKg: 100,
            overrides: [
              {
                week: 3,
                repMin: null,
                repMax: null,
                rir: null,
                rpe: null,
                suggestedLoadKg: 95,
                tempo: null,
                durationSec: null,
                distanceM: null,
                technique: null,
              },
            ],
          },
        ],
      }),
    )

    // Act
    await instantiateProgramDay(USER, 'd1', 3)

    // Assert
    expect(seededSets()[0].weight).toBe(95)
  })

  it('seeds a null weight for rpe-target with no history', async () => {
    // Arrange
    findFirst.mockResolvedValue(
      dayFixture({
        progression: { scheme: 'rpe-target', targetRpe: 8 },
        sets: [{ setNumber: 1, repMax: 5, suggestedLoadKg: 100 }],
      }),
    )

    // Act
    await instantiateProgramDay(USER, 'd1', 1)

    // Assert — no e1RM history → no derived load (base is NOT used for rpe-target)
    expect(seededSets()[0].weight).toBeNull()
  })

  it('derives the rpe-target load from batched history e1RM', async () => {
    // Arrange — best set 100×5 → e1RM 116.67; 5 @ RPE 8 = 81.1%
    historyBefore.mockResolvedValue([
      { wgerExerciseId: 1, source: 'wger', reps: 5, weight: 100, loggingType: 'weight_reps' },
      // Composite guard: a CUSTOM exercise sharing id 1 must not feed this anchor.
      { wgerExerciseId: 1, source: 'custom', reps: 5, weight: 500, loggingType: 'weight_reps' },
    ])
    findFirst.mockResolvedValue(
      dayFixture({
        progression: { scheme: 'rpe-target', targetRpe: 8 },
        sets: [{ setNumber: 1, repMax: 5 }],
      }),
    )

    // Act
    await instantiateProgramDay(USER, 'd1', 1)

    // Assert
    expect(seededSets()[0].weight).toBeCloseTo(100 * (1 + 5 / 30) * 0.811, 3)
  })

  it('excludes bodyweight-type history rows from the e1RM derivation', async () => {
    // Arrange — the only history is weighted-BW: its `weight` (25) is ADDED
    // load, not total, so it must not anchor an absolute-load prescription.
    historyBefore.mockResolvedValue([
      { wgerExerciseId: 1, source: 'wger', reps: 8, weight: 25, loggingType: 'weighted_bodyweight' },
    ])
    findFirst.mockResolvedValue(
      dayFixture({
        progression: { scheme: 'rpe-target', targetRpe: 8 },
        sets: [{ setNumber: 1, repMax: 5 }],
      }),
    )

    // Act
    await instantiateProgramDay(USER, 'd1', 1)

    // Assert — no admissible history → no derived load
    expect(seededSets()[0].weight).toBeNull()
  })

  it('grows the seeded set count for weekly-volume', async () => {
    // Arrange — mev 2 → mrv 4 over 3 non-deload weeks; week 3 = 4 sets
    findFirst.mockResolvedValue(
      dayFixture({
        mesocycleWeeks: 3,
        progression: { scheme: 'weekly-volume', mevSets: 2, mrvSets: 4 },
        sets: [
          { setNumber: 1, suggestedLoadKg: 100 },
          { setNumber: 2, suggestedLoadKg: 100 },
        ],
      }),
    )

    // Act
    await instantiateProgramDay(USER, 'd1', 3)

    // Assert
    expect(seededSets()).toHaveLength(4)
    expect(seededSets().map((s) => s.setNumber)).toEqual([1, 2, 3, 4])
  })

  it('consults double-progression history via getLastPerformance', async () => {
    // Arrange — last session hit 12s across the board → advance to 102.5
    lastPerformance.mockResolvedValue({
      performedAt: new Date(0),
      sets: [
        { reps: 12, weight: 100 },
        { reps: 12, weight: 100 },
      ],
    })
    findFirst.mockResolvedValue(
      dayFixture({
        progression: { scheme: 'double-progression', repMin: 8, repMax: 12, incrementKg: 2.5 },
        sets: [{ setNumber: 1, suggestedLoadKg: 100 }],
      }),
    )

    // Act
    await instantiateProgramDay(USER, 'd1', 2)

    // Assert
    expect(lastPerformance).toHaveBeenCalledWith(USER, 'wger', 1)
    expect(seededSets()[0].weight).toBe(102.5)
  })

  it('auto-derives the week from history when omitted', async () => {
    // Arrange — max(programWeek)=2; cycle complete (1 of 1 days done) → week 3
    findFirst.mockResolvedValue(dayFixture({ sets: [{ setNumber: 1, suggestedLoadKg: 100 }] }))
    selectQueue = [[{ current: 2 }], [{ value: 1 }], [{ value: 1 }]]

    // Act
    const result = await instantiateProgramDay(USER, 'd1', null)

    // Assert
    expect(result).toEqual({ id: 'w1', week: 3, weekDerived: true })
    expect(records[0].values).toMatchObject({ programWeek: 3 })
  })

  it('returns null and seeds nothing when the day is not owned', async () => {
    // Arrange
    const day = dayFixture({ sets: [{ setNumber: 1 }] })
    findFirst.mockResolvedValue({ ...day, program: { ...day.program, userId: 'someone_else' } })

    // Act
    const result = await instantiateProgramDay(USER, 'd1', 1)

    // Assert
    expect(result).toBeNull()
    expect(records).toHaveLength(0)
  })

  it('refuses a PROPOSED program day and seeds nothing (forced confirm)', async () => {
    // Arrange — a coach-drafted proposal: nothing may train it pre-adopt
    findFirst.mockResolvedValue(
      dayFixture({ status: 'proposed', sets: [{ setNumber: 1, suggestedLoadKg: 100 }] }),
    )

    // Act + Assert — clear refusal pointing at adopt/decline, no writes
    await expect(instantiateProgramDay(USER, 'd1', 1)).rejects.toThrow(/adopt/)
    expect(records).toHaveLength(0)
  })

  it('returns null and seeds nothing when the day does not exist', async () => {
    // Arrange
    findFirst.mockResolvedValue(undefined)

    // Act
    const result = await instantiateProgramDay(USER, 'missing', 1)

    // Assert
    expect(result).toBeNull()
    expect(records).toHaveLength(0)
  })
})

describe('instantiateProgramDay (resume semantics)', () => {
  it('resumes an existing unfinished instantiation for the same day and week', async () => {
    // Arrange — a stale abandoned row for (d1, week 3) already exists
    findFirst.mockResolvedValue(
      dayFixture({ sets: [{ setNumber: 1, suggestedLoadKg: 100 }] }),
    )
    selectQueue = [[{ id: 'w-old' }]]

    // Act
    const result = await instantiateProgramDay(USER, 'd1', 3)

    // Assert — the existing row comes back and NOTHING is inserted
    expect(result).toEqual({ id: 'w-old', week: 3, weekDerived: false })
    expect(records).toHaveLength(0)
    // The lookup must target UNFINISHED rows only — a completed instantiation
    // for the week is history, not a session to resume.
    expect(predicateMentionsColumn(capturedWheres[0], 'completed_at')).toBe(true)
  })

  it('creates a fresh instantiation when no unfinished row exists', async () => {
    findFirst.mockResolvedValue(
      dayFixture({ sets: [{ setNumber: 1, suggestedLoadKg: 100 }] }),
    )
    selectQueue = [[]]

    const result = await instantiateProgramDay(USER, 'd1', 3)

    expect(result).toEqual({ id: 'w1', week: 3, weekDerived: false })
    expect(records.length).toBeGreaterThan(0)
  })

  it('rejects an explicit week past the mesocycle (no garbage provenance)', async () => {
    // Arrange — 4-week program; week 5 has no home on the block's axis. The
    // web action and MCP tool both accept caller-supplied weeks, so the data
    // layer is the backstop against a forged/stale week poisoning
    // nextProgramWeek's max(programWeek) read.
    findFirst.mockResolvedValue(
      dayFixture({ mesocycleWeeks: 4, sets: [{ setNumber: 1, suggestedLoadKg: 100 }] }),
    )

    await expect(instantiateProgramDay(USER, 'd1', 5)).rejects.toThrow(/week/)
    expect(records).toHaveLength(0)
  })

  it('rejects an explicit week below 1', async () => {
    findFirst.mockResolvedValue(
      dayFixture({ mesocycleWeeks: 4, sets: [{ setNumber: 1, suggestedLoadKg: 100 }] }),
    )

    await expect(instantiateProgramDay(USER, 'd1', 0)).rejects.toThrow(/week/)
    expect(records).toHaveLength(0)
  })

  it('resumes on the DERIVED-week path too (lookup runs after nextProgramWeek)', async () => {
    // Arrange — week omitted: nextProgramWeek consumes selects 0-2
    // (current=2, 3 days, 1 done → stays week 2); the resume lookup is the
    // 4th select and finds a stale unfinished row for (d1, week 2).
    findFirst.mockResolvedValue(
      dayFixture({ sets: [{ setNumber: 1, suggestedLoadKg: 100 }] }),
    )
    selectQueue = [[{ current: 2 }], [{ value: 3 }], [{ value: 1 }], [{ id: 'w-old' }]]

    // Act
    const result = await instantiateProgramDay(USER, 'd1', null)

    // Assert — resumed at the derived week, nothing inserted, and the
    // lookup predicate still requires completion state
    expect(result).toEqual({ id: 'w-old', week: 2, weekDerived: true })
    expect(records).toHaveLength(0)
    expect(predicateMentionsColumn(capturedWheres[3], 'completed_at')).toBe(true)
  })
})

describe('nextProgramWeek', () => {
  it('returns 1 for a program with no instantiated workouts', async () => {
    selectQueue = [[{ current: null }]]
    expect(await nextProgramWeek(USER, 'p1', 4)).toBe(1)
  })

  it('stays on the current week while the cycle is incomplete', async () => {
    // current=2, 3 days total, only 1 COMPLETED at week 2
    selectQueue = [[{ current: 2 }], [{ value: 3 }], [{ value: 1 }]]
    expect(await nextProgramWeek(USER, 'p1', 4)).toBe(2)
  })

  it('counts only TRAINED days toward the week axis (both reads)', async () => {
    // Regression net for two shipped bugs: the merely-started-counts-as-done
    // bug (dropped isNotNull(completedAt)) and the cooked-block incident
    // (2026-07-19: ghost workouts with completedAt but ZERO completed sets
    // raised the observed week and advanced the cycle). The harness must
    // catch either predicate being dropped, which canned rows can't.
    selectQueue = [[{ current: 2 }], [{ value: 3 }], [{ value: 1 }]]

    await nextProgramWeek(USER, 'p1', 4)

    // Select order: current(0) · dayTotal(1) · daysDone(2)
    expect(predicateMentionsColumn(capturedWheres[2], 'completed_at')).toBe(true)
    expect(predicateMentionsColumn(capturedWheres[2], 'completed')).toBe(true)
    // The observed-week read requires trained (≥1 completed set) but NOT
    // completedAt: an in-progress final-day session still derives the same
    // week from the prior cycle (complete → current+1), so the hero can't
    // jump ahead mid-session — while never-trained ghosts stop pinning.
    expect(predicateMentionsColumn(capturedWheres[0], 'completed_at')).toBe(false)
    expect(predicateMentionsColumn(capturedWheres[0], 'completed')).toBe(true)
  })

  it('advances (clamped to the mesocycle) when every day is done', async () => {
    selectQueue = [[{ current: 4 }], [{ value: 2 }], [{ value: 2 }]]
    expect(await nextProgramWeek(USER, 'p1', 4)).toBe(4) // clamp: already at the last week
  })

  describe('programWeekState', () => {
    it('reports blockComplete when every day of the final week is done', async () => {
      // current=4 of meso 4, 3 days planned, 3 COMPLETED → the advancement
      // rule fires AT the last week: the block is finished (week clamps).
      selectQueue = [[{ current: 4 }], [{ value: 3 }], [{ value: 3 }]]

      expect(await programWeekState(USER, 'p1', 4)).toEqual({
        currentWeek: 4,
        blockComplete: true,
      })
    })

    it('is not complete while the final week is partial', async () => {
      // current=4 of meso 4, only 1 of 3 days COMPLETED
      selectQueue = [[{ current: 4 }], [{ value: 3 }], [{ value: 1 }]]

      expect(await programWeekState(USER, 'p1', 4)).toEqual({
        currentWeek: 4,
        blockComplete: false,
      })
    })

    it('advances a finished mid-block week without claiming completion', async () => {
      // current=2 of meso 4, all 3 days done → next week, still mid-block
      selectQueue = [[{ current: 2 }], [{ value: 3 }], [{ value: 3 }]]

      expect(await programWeekState(USER, 'p1', 4)).toEqual({
        currentWeek: 3,
        blockComplete: false,
      })
    })

    it('starts at week 1, incomplete, for an empty program history', async () => {
      // current null short-circuits before the day-count reads
      selectQueue = [[]]

      expect(await programWeekState(USER, 'p1', 4)).toEqual({
        currentWeek: 1,
        blockComplete: false,
      })
    })

    it('nextProgramWeek stays a byte-compatible wrapper over the same cases', async () => {
      // Same fixtures as above — the number every existing caller sees
      // must not move.
      selectQueue = [[{ current: 4 }], [{ value: 3 }], [{ value: 3 }]]
      expect(await nextProgramWeek(USER, 'p1', 4)).toBe(4)

      selectQueue = [[{ current: 4 }], [{ value: 3 }], [{ value: 1 }]]
      expect(await nextProgramWeek(USER, 'p1', 4)).toBe(4)

      selectQueue = [[{ current: 2 }], [{ value: 3 }], [{ value: 3 }]]
      expect(await nextProgramWeek(USER, 'p1', 4)).toBe(3)

      selectQueue = [[]]
      expect(await nextProgramWeek(USER, 'p1', 4)).toBe(1)
    })
  })
})

describe('getNextProgramDay', () => {
  it('rotates past a COMPLETED day only (logged query filters on completedAt)', async () => {
    // Select order: program(0) · days(1) · week: current(2)/dayTotal(3)/
    // daysDone(4) · logged(5) · exercises of the picked day(6)
    selectQueue = [
      [{ id: 'p1', name: 'Plan', mesocycleWeeks: 4 }],
      [
        { id: 'd1', name: 'Upper', position: 0 },
        { id: 'd2', name: 'Lower', position: 1 },
      ],
      [{ current: 1 }],
      [{ value: 2 }],
      [{ value: 1 }],
      [{ dayId: 'd1' }],
      [{ name: 'Squat' }],
    ]

    // Act
    const next = await getNextProgramDay(USER)

    // Assert — d1 done → d2 next, and the "done" set REQUIRED completion
    expect(next?.dayName).toBe('Lower')
    expect(next?.week).toBe(1)
    expect(next?.exerciseNames).toEqual(['Squat'])
    // Mid-block: the completion flag must stay down.
    expect(next?.blockComplete).toBe(false)
    expect(next?.mesocycleWeeks).toBe(4)
    expect(predicateMentionsColumn(capturedWheres[5], 'completed_at')).toBe(true)
    // The program pick binds status='active' — the structural exclusion of
    // 'proposed' rows from next-day derivation (a proposal can only become
    // active through the owner's adopt).
    expect(predicateMentionsColumn(capturedWheres[0], 'status')).toBe(true)
    expect(new PgDialect().sqlToQuery(capturedWheres[0] as SQL).params).toContain('active')
  })

  it('carries blockComplete through when the final week is fully done', async () => {
    // current=4 of meso 4, both days COMPLETED → block complete; every day
    // logged at week 4 makes the picker wrap to the first day (re-run path),
    // so the hero still gets a non-null payload carrying the flag.
    selectQueue = [
      [{ id: 'p1', name: 'Plan', mesocycleWeeks: 4 }],
      [
        { id: 'd1', name: 'Upper', position: 0 },
        { id: 'd2', name: 'Lower', position: 1 },
      ],
      [{ current: 4 }],
      [{ value: 2 }],
      [{ value: 2 }],
      [{ dayId: 'd1' }, { dayId: 'd2' }],
      [{ name: 'Bench' }],
    ]

    const next = await getNextProgramDay(USER)

    expect(next?.blockComplete).toBe(true)
    expect(next?.mesocycleWeeks).toBe(4)
    expect(next?.week).toBe(4) // clamped at the final week
    expect(next?.dayName).toBe('Upper') // wrap to the first day
  })
})
