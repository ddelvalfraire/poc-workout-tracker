import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stub for instantiateProgramDay. `db.query.programDays.findFirst`
 * returns the fixture day (the ownership read); `db.transaction(cb)` runs
 * `cb(tx)` where `tx.insert(table).values(v).returning()` records `v` and
 * resolves a deterministic id — so the test asserts the seed (provenance on the
 * workout row, suggested load on reps_weight sets, blank achievement fields)
 * without a real database. The sets insert has no `.returning()`.
 *
 * Returned ids by call order: workout → w1, exercise → e1.
 */
const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }))

const records: { values: unknown }[] = []
let idCounter = 0
const ID_SEQUENCE = ['w1', 'e1']

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
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
  },
}))

import { instantiateProgramDay } from './programs'

const USER = 'user_123'

/** A program day owned by USER: one exercise with a reps_weight set and a duration set. */
function dayFixture() {
  return {
    id: 'd1',
    name: 'Push',
    program: { userId: USER },
    exercises: [
      {
        id: 'pe1',
        wgerExerciseId: 1,
        name: 'Bench',
        position: 0,
        sets: [
          { setNumber: 1, metricMode: 'reps_weight', suggestedLoadKg: 100 },
          { setNumber: 2, metricMode: 'duration', suggestedLoadKg: null },
        ],
      },
    ],
  }
}

beforeEach(() => {
  records.length = 0
  idCounter = 0
  vi.clearAllMocks()
})

describe('instantiateProgramDay', () => {
  it('seeds a dated workout with provenance and per-metric suggested loads', async () => {
    // Arrange
    findFirst.mockResolvedValue(dayFixture())

    // Act
    const result = await instantiateProgramDay(USER, 'd1', 2)

    // Assert — provenance on the workout row
    expect(records[0].values).toEqual({
      userId: USER,
      name: 'Push',
      programDayId: 'd1',
      programWeek: 2,
    })
    // Exercise stamped with its 0-based position, linked to the new workout
    expect(records[1].values).toEqual({
      workoutId: 'w1',
      wgerExerciseId: 1,
      name: 'Bench',
      position: 0,
    })
    // reps_weight set seeds the load into weight; duration set seeds no weight.
    // Both leave the achievement fields (reps/duration/distance) blank.
    expect(records[2].values).toEqual([
      {
        workoutExerciseId: 'e1',
        setNumber: 1,
        reps: null,
        weight: 100,
        metricMode: 'reps_weight',
        durationSec: null,
        distanceM: null,
        completed: false,
      },
      {
        workoutExerciseId: 'e1',
        setNumber: 2,
        reps: null,
        weight: null,
        metricMode: 'duration',
        durationSec: null,
        distanceM: null,
        completed: false,
      },
    ])

    // Resolves to the new workout id
    expect(result).toEqual({ id: 'w1' })
  })

  it('returns null and seeds nothing when the day is not owned', async () => {
    // Arrange — day belongs to another user's program
    findFirst.mockResolvedValue({ ...dayFixture(), program: { userId: 'someone_else' } })

    // Act
    const result = await instantiateProgramDay(USER, 'd1', 1)

    // Assert
    expect(result).toBeNull()
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
