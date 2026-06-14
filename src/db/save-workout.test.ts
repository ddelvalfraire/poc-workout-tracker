import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stub for the Drizzle insert builder. `db.transaction(cb)` runs
 * `cb(tx)`; `tx.insert(table).values(v).returning()` records `v` (with a label
 * derived from call order) and resolves to a deterministic id row, so the test
 * can assert WHAT got written and in WHAT order without a real database.
 *
 * Returned ids by call order: 1st → w1, 2nd → e1, 3rd → s1, 4th → e2, ...
 */
const records: { values: unknown }[] = []
let idCounter = 0
const ID_SEQUENCE = ['w1', 'e1', 's1', 'e2', 's2']

function makeTx() {
  return {
    insert: () => ({
      values: (v: unknown) => {
        records.push({ values: v })
        return {
          returning: () => Promise.resolve([{ id: ID_SEQUENCE[idCounter++] }]),
        }
      },
    }),
  }
}

vi.mock('./index', () => ({
  db: {
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
  },
}))

import { saveWorkout } from './workouts'

const USER = 'user_123'

beforeEach(() => {
  records.length = 0
  idCounter = 0
})

describe('saveWorkout (transactional, user-scoped)', () => {
  it('writes the workout, exercises, and sets in order with correct linkage', async () => {
    // Act
    const result = await saveWorkout(USER, {
      name: 'Leg Day',
      exercises: [
        {
          wgerExerciseId: 73,
          name: 'Squat',
          sets: [
            { reps: 5, weight: 100 },
            { reps: 5, weight: 100 },
          ],
        },
      ],
    })

    // Assert — recorded inserts in call order
    expect(records[0].values).toEqual({ userId: USER, name: 'Leg Day' })
    expect(records[1].values).toEqual({
      workoutId: 'w1',
      wgerExerciseId: 73,
      name: 'Squat',
      position: 0,
    })
    expect(records[2].values).toEqual([
      { workoutExerciseId: 'e1', setNumber: 1, reps: 5, weight: 100 },
      { workoutExerciseId: 'e1', setNumber: 2, reps: 5, weight: 100 },
    ])

    // Assert — resolves to the new workout id
    expect(result).toEqual({ id: 'w1' })
  })

  it('stamps each exercise with its 0-based position', async () => {
    // Act
    await saveWorkout(USER, {
      exercises: [
        { wgerExerciseId: 1, name: 'Bench', sets: [] },
        { wgerExerciseId: 2, name: 'Row', sets: [] },
      ],
    })

    // Assert — only workout + two exercise inserts (no sets)
    expect(records).toHaveLength(3)
    expect(records[1].values).toMatchObject({ position: 0, wgerExerciseId: 1 })
    expect(records[2].values).toMatchObject({ position: 1, wgerExerciseId: 2 })
  })

  it('skips the sets insert when an exercise has no sets', async () => {
    // Act
    await saveWorkout(USER, {
      exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }],
    })

    // Assert — workout + exercise only
    expect(records).toHaveLength(2)
  })
})
