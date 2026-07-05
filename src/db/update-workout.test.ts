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

function makeTx() {
  return {
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
