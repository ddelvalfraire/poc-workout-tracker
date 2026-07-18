import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stub for updateWorkout's transaction. Extends the save-workout
 * idiom with `update` and `delete` recorders so the test can assert the control
 * flow (ownership gate → clear children → re-insert) and the written values
 * without a real database. `ownedRow` toggles the "owned" vs "not owned" gate.
 */
const records: { op: string; values?: unknown }[] = []
let ownedRow: { id: string }[] = [{ id: 'w1' }] // toggle to [] for not-owned
let idCounter = 0
const ID_SEQUENCE = ['e1', 's1', 'e2'] // exercise/set ids handed back on re-insert
// Prior set rows the pre-delete facts read returns (snapshot preservation).
// A read, so it is NOT pushed onto `records` — that stays the mutation log.
let priorFactRows: unknown[] = []

function makeTx() {
  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: () => selectChain,
    orderBy: () => Promise.resolve(priorFactRows),
  }
  return {
    select: () => selectChain,
    update: () => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: () => {
            records.push({ op: 'update', values })
            return Promise.resolve(ownedRow)
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => {
        records.push({ op: 'delete' })
        return Promise.resolve()
      },
    }),
    insert: () => ({
      values: (values: unknown) => {
        records.push({ op: 'insert', values })
        return { returning: () => Promise.resolve([{ id: ID_SEQUENCE[idCounter++] }]) }
      },
    }),
  }
}

vi.mock('./index', () => ({
  db: { transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()) },
}))

import { updateWorkout } from './workouts'

const USER = 'user_123'
const ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  records.length = 0
  idCounter = 0
  ownedRow = [{ id: 'w1' }]
  priorFactRows = []
})

describe('updateWorkout (transactional, user-scoped)', () => {
  it('updates the name, clears children, then re-inserts in order', async () => {
    // Act
    const result = await updateWorkout(USER, ID, {
      name: 'New name',
      exercises: [{ wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 5, weight: 100 }] }],
    })

    // Assert — ownership gate runs first, then delete, then ordered re-insert.
    // completedAt is a coalesce-to-now() SQL expression (first edit completes
    // an instantiated workout); assert presence, not its opaque shape.
    expect(records[0].op).toBe('update')
    expect(records[0].values).toMatchObject({ name: 'New name' })
    expect((records[0].values as Record<string, unknown>).completedAt).toBeDefined()
    expect(records[1].op).toBe('delete')
    expect(records[2]).toMatchObject({
      op: 'insert',
      values: { workoutId: ID, wgerExerciseId: 73, name: 'Squat', position: 0 },
    })
    expect(records[3]).toEqual({
      op: 'insert',
      values: [{ workoutExerciseId: 'e1', setNumber: 1, reps: 5, weight: 100, completed: false }],
    })
    expect(result).toEqual({ id: ID })
  })

  it('round-trips a checked-off set through the re-insert path', async () => {
    // Act — edit mode replaces children; the check-off must survive
    await updateWorkout(USER, ID, {
      exercises: [
        { wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 5, weight: 100, completed: true }] },
      ],
    })

    // Assert — the re-inserted set keeps completed: true
    expect(records[3]).toEqual({
      op: 'insert',
      values: [{ workoutExerciseId: 'e1', setNumber: 1, reps: 5, weight: 100, completed: true }],
    })
  })

  it('never embeds a raw Date in the completedAt SQL fragment (driver rejects it)', async () => {
    // Regression: params inside a raw sql`` fragment bypass the column's
    // Date→string mapping, and postgres.js throws ERR_INVALID_ARG_TYPE on a
    // Date instance — every backdated edit failed in prod. The explicit
    // date must be serialized before interpolation.
    const containsDate = (value: unknown, seen = new Set<object>()): boolean => {
      if (value instanceof Date) return true
      if (!value || typeof value !== 'object') return false
      if (seen.has(value)) return false
      seen.add(value)
      return Object.values(value).some((v) => containsDate(v, seen))
    }

    // Act — explicit startedAt takes the backdated-completion branch
    await updateWorkout(USER, ID, {
      startedAt: new Date('2026-07-04T20:43:20.856Z'),
      exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }],
    })

    // Assert
    const completedAt = (records[0].values as Record<string, unknown>).completedAt
    expect(completedAt).toBeDefined()
    expect(containsDate(completedAt)).toBe(false)
  })

  it('clears the name to null when input has none', async () => {
    // Act
    await updateWorkout(USER, ID, { exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }] })

    // Assert
    expect(records[0].op).toBe('update')
    expect(records[0].values).toMatchObject({ name: null })
  })

  it('re-stamps the prescribed_* snapshot onto re-inserted sets (immutable facts survive the replace)', async () => {
    // Arrange — the instantiated set carried a snapshot; the wire input
    // never does.
    priorFactRows = [
      {
        wgerExerciseId: 73,
        source: 'wger',
        setNumber: 1,
        setType: 'working',
        prescribedLoadKg: 100,
        prescribedRepMin: 8,
      },
    ]

    // Act
    await updateWorkout(USER, ID, {
      exercises: [{ wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 5, weight: 102.5 }] }],
    })

    // Assert — the replaced row still carries the facts
    expect(records[3].values).toEqual([
      expect.objectContaining({
        setNumber: 1,
        weight: 102.5,
        prescribedLoadKg: 100,
        prescribedRepMin: 8,
      }),
    ])
  })

  it('preserves backoff/amrap typing the draft UI cannot express, but lets a warmup retag win', async () => {
    // Arrange — set 1 was a backoff (no wire representation), set 2 working.
    priorFactRows = [
      {
        wgerExerciseId: 73,
        source: 'wger',
        setNumber: 1,
        setType: 'backoff',
        prescribedLoadKg: 80,
        prescribedRepMin: null,
      },
      {
        wgerExerciseId: 73,
        source: 'wger',
        setNumber: 2,
        setType: 'working',
        prescribedLoadKg: 100,
        prescribedRepMin: 8,
      },
    ]

    // Act — the input retags set 2 as warmup and says nothing about set 1
    await updateWorkout(USER, ID, {
      exercises: [
        {
          wgerExerciseId: 73,
          name: 'Squat',
          sets: [{ reps: 8, weight: 80 }, { reps: 5, weight: 60, setType: 'warmup' }],
        },
      ],
    })

    // Assert — backoff survives; the explicit warmup wins over the prior type
    const values = records[3].values as Record<string, unknown>[]
    expect(values[0]).toMatchObject({ setType: 'backoff', prescribedLoadKg: 80 })
    expect(values[1]).toMatchObject({ setType: 'warmup', prescribedLoadKg: 100 })
  })

  it('leaves brand-new sets fact-less (no snapshot invented for ad-hoc rows)', async () => {
    // Arrange — only set 1 existed before the replace
    priorFactRows = [
      {
        wgerExerciseId: 73,
        source: 'wger',
        setNumber: 1,
        setType: 'working',
        prescribedLoadKg: 100,
        prescribedRepMin: 8,
      },
    ]

    // Act — the edit appends a second set
    await updateWorkout(USER, ID, {
      exercises: [
        { wgerExerciseId: 73, name: 'Squat', sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 100 }] },
      ],
    })

    // Assert — set 2 carries no snapshot keys at all
    const values = records[3].values as Record<string, unknown>[]
    expect(values[0]).toMatchObject({ prescribedLoadKg: 100 })
    expect('prescribedLoadKg' in values[1]).toBe(false)
    expect('prescribedRepMin' in values[1]).toBe(false)
  })

  it('returns null and mutates nothing when the user does not own the workout', async () => {
    // Arrange
    ownedRow = []

    // Act
    const result = await updateWorkout(USER, ID, {
      exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }],
    })

    // Assert — early return before any delete/insert (security-critical)
    expect(result).toBeNull()
    expect(records).toHaveLength(1)
    expect(records[0].op).toBe('update')
    expect(records[0].values).toMatchObject({ name: null })
  })
})
