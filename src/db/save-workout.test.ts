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

const CTX = { actor: 'ui', kind: 'original' } as const

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
    }, CTX)

    // Assert — recorded inserts in call order
    // Saving a manual log IS completing it — completedAt is stamped at save.
    expect(records[0].values).toEqual({
      userId: USER,
      name: 'Leg Day',
      completedAt: expect.any(Date),
    })
    expect(records[1].values).toEqual({
      workoutId: 'w1',
      wgerExerciseId: 73,
      name: 'Squat',
      position: 0,
    })
    expect(records[2].values).toEqual([
      { workoutExerciseId: 'e1', setNumber: 1, reps: 5, weight: 100, completed: false },
      { workoutExerciseId: 'e1', setNumber: 2, reps: 5, weight: 100, completed: false },
    ])

    // Assert — resolves to the new workout id
    expect(result).toEqual({ id: 'w1' })
  })

  it('persists a checked-off set as completed, defaulting the rest to false', async () => {
    // Act — set 1 checked in-session, set 2 left unchecked (flag absent)
    await saveWorkout(USER, {
      exercises: [
        {
          wgerExerciseId: 73,
          name: 'Squat',
          sets: [{ reps: 5, weight: 100, completed: true }, { reps: 5, weight: 100 }],
        },
      ],
    }, CTX)

    // Assert
    expect(records[2].values).toEqual([
      { workoutExerciseId: 'e1', setNumber: 1, reps: 5, weight: 100, completed: true },
      { workoutExerciseId: 'e1', setNumber: 2, reps: 5, weight: 100, completed: false },
    ])
  })

  it('persists a warm-up setType, defaulting untagged sets via the column', async () => {
    // Act — set 1 tagged warm-up, set 2 untagged (column default applies)
    await saveWorkout(USER, {
      exercises: [
        {
          wgerExerciseId: 73,
          name: 'Squat',
          sets: [{ reps: 5, weight: 60, setType: 'warmup' }, { reps: 5, weight: 100 }],
        },
      ],
    }, CTX)

    // Assert
    expect(records[2].values).toEqual([
      { workoutExerciseId: 'e1', setNumber: 1, reps: 5, weight: 60, completed: false, setType: 'warmup' },
      { workoutExerciseId: 'e1', setNumber: 2, reps: 5, weight: 100, completed: false },
    ])
  })

  it('stamps completedAt from startedAt for backdated saves, not wall-clock now', async () => {
    // Arrange — a log backdated a week (MCP create_workout documents this)
    const startedAt = new Date('2026-06-01T10:00:00.000Z')

    // Act
    await saveWorkout(USER, { name: 'Backdated', startedAt, exercises: [] }, CTX)

    // Assert — the session completed when it happened, not when it was saved
    expect(records[0].values).toEqual({
      userId: USER,
      name: 'Backdated',
      startedAt,
      completedAt: startedAt,
    })
  })

  it('prefers an explicit completedAt over the startedAt fallback', async () => {
    // Arrange — a live session: opened at 10:00, saved at 10:42
    const startedAt = new Date('2026-06-01T10:00:00.000Z')
    const completedAt = new Date('2026-06-01T10:42:00.000Z')

    // Act
    await saveWorkout(USER, { name: 'Live', startedAt, completedAt, exercises: [] }, CTX)

    // Assert
    expect(records[0].values).toEqual({
      userId: USER,
      name: 'Live',
      startedAt,
      completedAt,
    })
  })

  it('stamps each exercise with its 0-based position', async () => {
    // Act
    await saveWorkout(USER, {
      exercises: [
        { wgerExerciseId: 1, name: 'Bench', sets: [] },
        { wgerExerciseId: 2, name: 'Row', sets: [] },
      ],
    }, CTX)

    // Assert — workout + two exercise inserts (no sets), then the one
    // 'original' changelog row every creation writes.
    expect(records).toHaveLength(4)
    expect(records[1].values).toMatchObject({ position: 0, wgerExerciseId: 1 })
    expect(records[2].values).toMatchObject({ position: 1, wgerExerciseId: 2 })
  })

  it('persists a provided loggingType and omits it when absent (column default)', async () => {
    // Act — a weighted pull-up alongside a legacy-shaped exercise
    await saveWorkout(USER, {
      exercises: [
        { wgerExerciseId: 1, name: 'Pull-up', loggingType: 'weighted_bodyweight', sets: [] },
        { wgerExerciseId: 2, name: 'Bench', sets: [] },
      ],
    }, CTX)

    // Assert — the provided type is written; the absent one leaves the key off
    // entirely so the DB default ('weight_reps') applies.
    expect(records[1].values).toMatchObject({ loggingType: 'weighted_bodyweight' })
    expect(records[2].values).not.toHaveProperty('loggingType')
  })

  it('writes session and exercise notes into the notes table (legacy columns dead)', async () => {
    // Act
    await saveWorkout(USER, {
      name: 'Leg Day',
      notes: 'good session',
      exercises: [{ wgerExerciseId: 73, name: 'Squat', notes: 'felt heavy', sets: [] }],
    }, CTX)

    // Assert — no notes column on the workout or exercise inserts; one
    // batched notes-table insert instead, exercise note with its snapshot.
    expect(records[0].values).not.toHaveProperty('notes')
    expect(records[1].values).not.toHaveProperty('notes')
    expect(records[2].values).toEqual([
      { userId: USER, author: 'user', body: 'good session', workoutId: 'w1' },
      {
        userId: USER,
        author: 'user',
        body: 'felt heavy',
        workoutExerciseId: 'e1',
        anchorSnapshot: { exerciseName: 'Squat' },
      },
    ])
  })

  it('skips the sets insert when an exercise has no sets', async () => {
    // Act
    await saveWorkout(USER, {
      exercises: [{ wgerExerciseId: 1, name: 'Plank', sets: [] }],
    }, CTX)

    // Assert — workout + exercise, plus the creation's changelog row
    expect(records).toHaveLength(3)
  })
})
