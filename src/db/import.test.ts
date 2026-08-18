import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ParsedImport, ParsedSet } from '@/lib/import/types'

/**
 * Recording stub for the Drizzle builders db/import.ts uses:
 *  - db.select().from().where()            → resolves state.existingWorkouts
 *  - db.insert(table).values(v)            → records {table, values}; awaitable;
 *      .returning() resolves [{id: id<n>}]; .onConflictDoNothing() awaitable
 *  - db.transaction(cb)                    → counts, runs cb against the same stub
 *  - db.delete(table).where().returning()  → per-table configured rows (undo)
 * Tables are matched by IDENTITY against the imported schema objects, so the
 * test asserts WHAT was written WHERE without a real database.
 */
const state = vi.hoisted(() => ({
  existingWorkouts: [] as { startedAt: Date; name: string | null }[],
  inserts: [] as { table: unknown; values: unknown; conflictHandled: boolean }[],
  transactions: 0,
  idCounter: 0,
  deleteResults: new Map<unknown, { id: string }[]>(),
  deletes: [] as { table: unknown }[],
}))

const mockDb = vi.hoisted(() => {
  const stateRef = state as unknown as {
    existingWorkouts: unknown[]
    inserts: { table: unknown; values: unknown; conflictHandled: boolean }[]
    transactions: number
    idCounter: number
    deleteResults: Map<unknown, { id: string }[]>
    deletes: { table: unknown }[]
  }
  function insert(table: unknown) {
    return {
      values: (v: unknown) => {
        const record = { table, values: v, conflictHandled: false }
        stateRef.inserts.push(record)
        return {
          onConflictDoNothing: () => {
            record.conflictHandled = true
            return Promise.resolve()
          },
          returning: () => Promise.resolve([{ id: `id${++stateRef.idCounter}` }]),
          then: (resolve?: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(undefined).then(resolve, reject),
        }
      },
    }
  }
  function remove(table: unknown) {
    stateRef.deletes.push({ table })
    return {
      where: () => ({
        returning: () => Promise.resolve(stateRef.deleteResults.get(table) ?? []),
      }),
    }
  }
  const handle = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(stateRef.existingWorkouts),
          then: (resolve?: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(stateRef.existingWorkouts).then(resolve, reject),
        }),
      }),
    }),
    insert,
    delete: remove,
    transaction: async (cb: (tx: unknown) => unknown) => {
      stateRef.transactions += 1
      return cb(handle)
    },
  }
  return handle
})

vi.mock('./index', () => ({ db: mockDb }))
vi.mock('@/lib/wger', () => ({ getAllExercises: vi.fn() }))
vi.mock('./custom-exercises', () => ({ listCustomExercises: vi.fn() }))
// The trophy seam is unit-tested in lib/trophies.test.ts; here we assert only
// that commit fires it with the RETROACTIVE-QUIET 'import' trigger.
vi.mock('@/lib/trophies', () => ({ checkTrophies: vi.fn(async () => []) }))

import { getAllExercises } from '@/lib/wger'
import { checkTrophies } from '@/lib/trophies'
import { listCustomExercises } from './custom-exercises'
import { customExercises, importBatches, notes, sets, workoutExercises, workouts } from './schema'
import { commitImport, ImportPlanError, planImport, undoImport, type ImportPlan } from './import'

const mockedCatalog = vi.mocked(getAllExercises)
const mockedCustoms = vi.mocked(listCustomExercises)
const mockedCheckTrophies = vi.mocked(checkTrophies)

const USER = 'user_123'

function workingSet(overrides: Partial<ParsedSet> = {}): ParsedSet {
  return {
    reps: 5,
    weightKg: 100,
    setType: 'working',
    metricMode: 'reps_weight',
    durationSec: null,
    completed: true,
    ...overrides,
  }
}

function parsedFixture(): ParsedImport {
  return {
    source: 'strong',
    sourceUnit: 'kg',
    workouts: [
      {
        name: 'Push Day',
        startedAt: '2024-01-15T17:32:11.000Z',
        completedAt: '2024-01-15T18:44:11.000Z',
        notes: 'Great session',
        exercises: [
          {
            name: 'Bench Press (Barbell)',
            notes: 'Felt heavy',
            sets: [workingSet(), workingSet({ setType: 'warmup', weightKg: 60 })],
          },
          { name: 'Nordic Curl (Rig)', sets: [workingSet({ weightKg: null })] },
        ],
      },
      {
        name: 'Pull Day',
        startedAt: '2024-01-17T09:00:00.000Z',
        completedAt: '2024-01-17T10:00:00.000Z',
        exercises: [{ name: 'Bench Press (Barbell)', sets: [workingSet()] }],
      },
    ],
    skipped: [{ row: 9, reason: 'distance/cardio set (not imported in v1)' }],
    warnings: [],
  }
}

beforeEach(() => {
  state.existingWorkouts = []
  state.inserts.length = 0
  state.deletes.length = 0
  state.transactions = 0
  state.idCounter = 0
  state.deleteResults.clear()
  mockedCatalog.mockReset()
  mockedCustoms.mockReset()
  mockedCatalog.mockResolvedValue([{ id: 73, name: 'Bench Press', category: 'Chest' }])
  mockedCustoms.mockResolvedValue([])
})

describe('planImport', () => {
  it('resolves exercises against the merged catalog and lists creates', async () => {
    const plan = await planImport(USER, parsedFixture())

    expect(plan.matched).toEqual([
      { importName: 'Bench Press (Barbell)', source: 'wger', id: 73, name: 'Bench Press' },
    ])
    expect(plan.toCreate).toEqual(['Nordic Curl (Rig)'])
    expect(plan.workoutCount).toBe(2)
    expect(plan.setCount).toBe(4)
    expect(plan.duplicates).toEqual([])
    expect(plan.skipped).toEqual(parsedFixture().skipped)
    expect(plan.dateRange).toEqual({
      from: new Date('2024-01-15T17:32:11.000Z'),
      to: new Date('2024-01-17T09:00:00.000Z'),
    })
  })

  it('flags (startedAt, name) duplicates and excludes them from the counts', async () => {
    state.existingWorkouts = [{ startedAt: new Date('2024-01-15T17:32:11.000Z'), name: 'Push Day' }]

    const plan = await planImport(USER, parsedFixture())

    expect(plan.duplicates).toEqual([
      { name: 'Push Day', startedAt: new Date('2024-01-15T17:32:11.000Z') },
    ])
    expect(plan.workoutCount).toBe(1)
    expect(plan.setCount).toBe(1)
    expect(plan.workouts.map((w) => w.isDuplicate)).toEqual([true, false])
  })

  it('does not flag a same-name workout at a different time', async () => {
    state.existingWorkouts = [{ startedAt: new Date('2024-02-01T17:32:11.000Z'), name: 'Push Day' }]
    const plan = await planImport(USER, parsedFixture())
    expect(plan.duplicates).toEqual([])
  })

  it('throws ImportPlanError above the 100-custom cap', async () => {
    const parsed: ParsedImport = {
      source: 'hevy',
      sourceUnit: 'kg',
      workouts: [
        {
          startedAt: '2024-01-15T17:32:11.000Z',
          completedAt: '2024-01-15T18:00:00.000Z',
          exercises: Array.from({ length: 101 }, (_, i) => ({
            name: `Unknown Movement ${i}`,
            sets: [workingSet()],
          })),
        },
      ],
      skipped: [],
      warnings: [],
    }
    await expect(planImport(USER, parsed)).rejects.toBeInstanceOf(ImportPlanError)
  })
})

function planFixture(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return {
    source: 'strong',
    sourceUnit: 'kg',
    workouts: [
      {
        name: 'Push Day',
        startedAt: new Date('2024-01-15T17:32:11.000Z'),
        completedAt: new Date('2024-01-15T18:44:11.000Z'),
        notes: 'Great session',
        isDuplicate: false,
        exercises: [
          {
            name: 'Bench Press (Barbell)',
            notes: 'Felt heavy',
            sets: [workingSet(), workingSet({ setType: 'warmup', weightKg: 60 })],
          },
          {
            name: 'Nordic Curl (Rig)',
            sets: [
              workingSet({ weightKg: null, reps: null, metricMode: 'duration', durationSec: 45 }),
            ],
          },
        ],
      },
      {
        name: 'Old Day',
        startedAt: new Date('2024-01-01T09:00:00.000Z'),
        completedAt: new Date('2024-01-01T10:00:00.000Z'),
        isDuplicate: true,
        exercises: [{ name: 'Bench Press (Barbell)', sets: [workingSet()] }],
      },
    ],
    resolutions: new Map([
      ['Bench Press (Barbell)', { kind: 'match', source: 'wger', id: 73, name: 'Bench Press' }],
      ['Nordic Curl (Rig)', { kind: 'create' }],
    ]),
    matched: [{ importName: 'Bench Press (Barbell)', source: 'wger', id: 73, name: 'Bench Press' }],
    toCreate: ['Nordic Curl (Rig)'],
    duplicates: [{ name: 'Old Day', startedAt: new Date('2024-01-01T09:00:00.000Z') }],
    skipped: [],
    warnings: [],
    workoutCount: 1,
    setCount: 3,
    dateRange: {
      from: new Date('2024-01-01T09:00:00.000Z'),
      to: new Date('2024-01-15T17:32:11.000Z'),
    },
    ...overrides,
  }
}

describe('commitImport', () => {
  it('creates customs, writes the batch row, and inserts the non-duplicate tree', async () => {
    mockedCustoms.mockResolvedValue([
      {
        id: 42,
        userId: USER,
        name: 'Nordic Curl (Rig)',
        category: 'Legs',
        equipment: null,
        muscles: null,
        musclesSecondary: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const result = await commitImport(USER, planFixture(), 'strong_export.csv')

    // Customs first, converging on the unique via onConflictDoNothing.
    const customInsert = state.inserts.find((i) => i.table === customExercises)
    // Category is the keyword heuristic's best effort ('curl' → Arms).
    expect(customInsert?.values).toEqual([
      { userId: USER, name: 'Nordic Curl (Rig)', category: 'Arms' },
    ])
    expect(customInsert?.conflictHandled).toBe(true)

    // Batch row carries the plan's counts and the file name.
    const batchInsert = state.inserts.find((i) => i.table === importBatches)
    expect(batchInsert?.values).toEqual({
      userId: USER,
      source: 'strong',
      fileName: 'strong_export.csv',
      workoutCount: 1,
      setCount: 3,
    })

    // One workout (the duplicate skipped), stamped with the batch id.
    const workoutInserts = state.inserts.filter((i) => i.table === workouts)
    expect(workoutInserts).toHaveLength(1)
    expect(workoutInserts[0].values).toMatchObject({
      userId: USER,
      name: 'Push Day',
      startedAt: new Date('2024-01-15T17:32:11.000Z'),
      completedAt: new Date('2024-01-15T18:44:11.000Z'),
      importBatchId: 'id1', // the batch insert was the first returning id
    })
    // Legacy notes column dead — no workout insert carries notes.
    expect(workoutInserts[0].values).not.toHaveProperty('notes')

    // Exercises: matched → canonical wger name; created → verbatim custom.
    const exerciseInserts = state.inserts.filter((i) => i.table === workoutExercises)
    expect(exerciseInserts.map((i) => i.values)).toEqual([
      expect.objectContaining({
        wgerExerciseId: 73,
        source: 'wger',
        name: 'Bench Press',
        position: 0,
      }),
      expect.objectContaining({
        wgerExerciseId: 42,
        source: 'custom',
        name: 'Nordic Curl (Rig)',
        position: 1,
      }),
    ])

    // Sets: completed, setType/metricMode/duration preserved, 1-based numbers.
    const setInserts = state.inserts.filter((i) => i.table === sets)
    expect(setInserts[0].values).toEqual([
      expect.objectContaining({ setNumber: 1, weight: 100, completed: true, setType: 'working' }),
      expect.objectContaining({ setNumber: 2, weight: 60, completed: true, setType: 'warmup' }),
    ])
    expect(setInserts[1].values).toEqual([
      expect.objectContaining({
        setNumber: 1,
        reps: null,
        weight: null,
        metricMode: 'duration',
        durationSec: 45,
        completed: true,
      }),
    ])

    // Notes land in the notes table (notes v2), dated to the session, the
    // exercise note with its standard snapshot.
    const noteInserts = state.inserts.filter((i) => i.table === notes)
    expect(noteInserts).toHaveLength(1)
    expect(noteInserts[0].values).toEqual([
      expect.objectContaining({
        userId: USER,
        author: 'user',
        body: 'Great session',
        createdAt: new Date('2024-01-15T17:32:11.000Z'),
      }),
      expect.objectContaining({
        author: 'user',
        body: 'Felt heavy',
        anchorSnapshot: { exerciseName: 'Bench Press' },
      }),
    ])

    expect(result).toEqual({
      batchId: 'id1',
      workoutsImported: 1,
      setsImported: 3,
      duplicatesSkipped: 1,
      customsCreated: 1,
    })

    // Imported history may complete trophies — but ONLY via the retroactive-
    // quiet trigger: 'import' stamps silently (no push, no celebration).
    expect(mockedCheckTrophies).toHaveBeenCalledWith(USER, { kind: 'import' })
  })

  it('skips the custom-create insert entirely when everything matched', async () => {
    const plan = planFixture({
      toCreate: [],
      workouts: [planFixture().workouts[1]],
      workoutCount: 0,
      setCount: 0,
    })
    await commitImport(USER, plan, null)
    expect(state.inserts.some((i) => i.table === customExercises)).toBe(false)
  })

  it('chunks large imports into multiple transactions', async () => {
    const many = Array.from({ length: 26 }, (_, i) => ({
      name: `Day ${i}`,
      startedAt: new Date(2024, 0, 1 + i),
      completedAt: new Date(2024, 0, 1 + i),
      isDuplicate: false,
      exercises: [{ name: 'Bench Press (Barbell)', sets: [workingSet()] }],
    }))
    const plan = planFixture({
      workouts: many,
      toCreate: [],
      duplicates: [],
      workoutCount: 26,
      setCount: 26,
    })

    const result = await commitImport(USER, plan, null)

    // 26 workouts at 25 per tx → 2 transactions.
    expect(state.transactions).toBe(2)
    expect(result.workoutsImported).toBe(26)
  })

  it('fails loudly when a to-create custom is missing after the create step', async () => {
    mockedCustoms.mockResolvedValue([]) // create silently didn't land
    await expect(commitImport(USER, planFixture(), null)).rejects.toThrow('missing custom exercise')
  })
})

describe('undoImport', () => {
  it('deletes the batch workouts and the batch row for the owner', async () => {
    state.deleteResults.set(workouts, [{ id: 'w1' }, { id: 'w2' }])
    state.deleteResults.set(importBatches, [{ id: 'b1' }])

    const result = await undoImport(USER, 'b1')

    expect(result).toEqual({ workoutsDeleted: 2 })
    // Workouts must be deleted BEFORE the batch row (SET NULL would detach).
    expect(state.deletes.map((d) => d.table)).toEqual([workouts, importBatches])
    expect(state.transactions).toBe(1)
  })

  it('returns null when the batch is not owned (or absent)', async () => {
    state.deleteResults.set(workouts, [])
    state.deleteResults.set(importBatches, [])
    expect(await undoImport(USER, 'someone-elses-batch')).toBeNull()
  })
})
