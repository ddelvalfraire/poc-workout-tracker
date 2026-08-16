import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTableName, type Table } from 'drizzle-orm'

/**
 * Chain-recording mock for the set-level ops, extending the update-workout idiom.
 * `selectQueue` feeds the ownership lookup and the max(setNumber) read in call
 * order; the *Rows vars toggle the update/delete/returning outcomes so a test can
 * drive the owned vs not-owned and found vs missing gates without a database.
 */
const records: { op: string; values?: unknown }[] = []
let selectQueue: unknown[][] = []
let updatedSetRows: { id: string }[] = [{ id: 's9' }]
let deletedSetRows: { id: string }[] = [{ id: 's9' }]
let ownedWorkoutRows: { id: string }[] = [{ id: 'w1' }]

type Resolve = (value: unknown) => unknown

function selectChain() {
  const rows = selectQueue.shift() ?? []
  const obj = {
    from: () => obj,
    innerJoin: () => obj,
    where: () => obj,
    limit: () => obj,
    then: (resolve: Resolve) => Promise.resolve(rows).then(resolve),
  }
  return obj
}

// Derive the real table name from the arg so a test asserts WHICH table an
// update targeted (e.g. the renumber must hit `sets`, not `workouts`).
function updateChain(table: unknown) {
  const name = getTableName(table as Table)
  const obj = {
    set: (values: unknown) => {
      records.push({ op: `update:${name}`, values })
      return obj
    },
    where: () => obj,
    returning: () => ({
      then: (resolve: Resolve) =>
        Promise.resolve(name === 'workouts' ? ownedWorkoutRows : updatedSetRows).then(resolve),
    }),
    // The renumber path awaits .where() directly (no .returning()).
    then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
  }
  return obj
}

function deleteChain() {
  records.push({ op: 'delete' })
  const obj = {
    where: () => obj,
    returning: () => ({ then: (resolve: Resolve) => Promise.resolve(deletedSetRows).then(resolve) }),
  }
  return obj
}

function insertChain() {
  return {
    values: (values: unknown) => {
      records.push({ op: 'insert', values })
      return Promise.resolve()
    },
  }
}

function makeTx() {
  return {
    select: () => selectChain(),
    update: (table: unknown) => updateChain(table),
    delete: () => deleteChain(),
    insert: () => insertChain(),
  }
}

vi.mock('./index', () => ({
  db: {
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
    update: (table: unknown) => updateChain(table),
  },
}))

import { updateSet, addSet, removeSet, updateWorkoutMeta, updateExerciseMeta } from './workouts'
import { SetCompletionError } from './workout-errors'

const USER = 'user_123'
const WID = '11111111-1111-1111-1111-111111111111'

/** The row shape updateSet's completion read-gate selects, with overridable
 *  fields — defaults model an uncompleted reps_weight set on a weight_reps
 *  exercise. */
function rowRead(
  overrides: Partial<{
    completed: boolean
    weight: number | null
    durationSec: number | null
    metricMode: string
    loggingType: string
  }> = {},
) {
  return {
    completed: false,
    weight: null,
    durationSec: null,
    metricMode: 'reps_weight',
    loggingType: 'weight_reps',
    ...overrides,
  }
}

beforeEach(() => {
  records.length = 0
  selectQueue = []
  updatedSetRows = [{ id: 's9' }]
  deletedSetRows = [{ id: 's9' }]
  ownedWorkoutRows = [{ id: 'w1' }]
})

describe('updateSet (user-scoped)', () => {
  it('updates the addressed set, then stamps workout completion', async () => {
    // Arrange — ownership lookup resolves an exercise
    selectQueue = [[{ id: 'ex1' }]]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { reps: 5, weight: 100 })

    // Assert — set write first, then the coalescing completedAt stamp
    expect(records.map((r) => r.op)).toEqual(['update:sets', 'update:workouts'])
    expect(records[0].values).toEqual({ reps: 5, weight: 100 })
    expect(Object.keys(records[1].values as object)).toEqual(['completedAt'])
    expect(result).toEqual({ id: 's9' })
  })

  it('completes a set after the pre-write read proves its metric is present', async () => {
    // Arrange — ownership lookup, then the completion read-gate's row
    selectQueue = [[{ id: 'ex1' }], [rowRead({ weight: 100 })]]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { completed: true })

    // Assert — only the flag written, and it still counts as a non-empty patch
    expect(records[0].values).toEqual({ completed: true })
    expect(result).toEqual({ id: 's9' })
  })

  it('refuses completing a weight-less weight_reps set (SetCompletionError, no write)', async () => {
    // Arrange
    selectQueue = [[{ id: 'ex1' }], [rowRead({ weight: null })]]

    // Act + Assert — #206 at the db boundary
    await expect(updateSet(USER, WID, 0, 3, { completed: true })).rejects.toBeInstanceOf(
      SetCompletionError,
    )
    expect(records).toEqual([])
  })

  it('refuses nulling the weight of a completed weight_reps set; bodyweight is exempt', async () => {
    // Arrange — the row is already completed; the patch would blank its metric
    selectQueue = [[{ id: 'ex1' }], [rowRead({ completed: true, weight: 80 })]]

    // Act + Assert
    await expect(updateSet(USER, WID, 0, 3, { weight: null })).rejects.toBeInstanceOf(
      SetCompletionError,
    )
    expect(records).toEqual([])

    // Arrange — same patch on a bodyweight exercise reads fine
    selectQueue = [
      [{ id: 'ex1' }],
      [rowRead({ completed: true, weight: null, loggingType: 'bodyweight_reps' })],
    ]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { weight: null })

    // Assert
    expect(result).toEqual({ id: 's9' })
  })

  it('refuses nulling the duration of a completed cardio set, and a mode flip that strands one', async () => {
    // Arrange — completed duration set; the patch blanks its metric
    selectQueue = [
      [{ id: 'ex1' }],
      [rowRead({ completed: true, durationSec: 1800, metricMode: 'duration' })],
    ]

    // Act + Assert
    await expect(updateSet(USER, WID, 0, 3, { durationSec: null })).rejects.toBeInstanceOf(
      SetCompletionError,
    )

    // Arrange — flipping a completed reps_weight set to duration with no duration
    selectQueue = [[{ id: 'ex1' }], [rowRead({ completed: true, weight: 100 })]]

    // Act + Assert
    await expect(updateSet(USER, WID, 0, 3, { metricMode: 'duration' })).rejects.toBeInstanceOf(
      SetCompletionError,
    )
  })

  it('skips the pre-write read when the patch cannot break completion (fast path)', async () => {
    // Arrange — ONLY the ownership lookup is queued; a second select would
    // shift an empty result and null the update, so success proves no read.
    selectQueue = [[{ id: 'ex1' }]]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { reps: 5, weight: 100 })

    // Assert
    expect(result).toEqual({ id: 's9' })
    expect(records.map((r) => r.op)).toEqual(['update:sets', 'update:workouts'])
  })

  it('returns null (not-found) when the completion read finds no such set', async () => {
    // Arrange — owned, but the read-gate finds no row
    selectQueue = [[{ id: 'ex1' }], []]

    // Act
    const result = await updateSet(USER, WID, 0, 9, { completed: true })

    // Assert — no write, no completion stamp
    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('does not stamp completion when no such set exists', async () => {
    // Arrange — owned, but the update matches no row
    selectQueue = [[{ id: 'ex1' }]]
    updatedSetRows = []

    // Act
    const result = await updateSet(USER, WID, 0, 9, { reps: 5 })

    // Assert — the failed set write must not mark the workout completed
    expect(result).toBeNull()
    expect(records.map((r) => r.op)).toEqual(['update:sets'])
  })

  it('returns null and writes nothing when the workout is not owned', async () => {
    // Arrange — ownership lookup finds nothing
    selectQueue = [[]]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { reps: 5 })

    // Assert — security-critical: no update issued
    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('returns null for an empty patch without querying', async () => {
    // Act
    const result = await updateSet(USER, WID, 0, 3, {})

    // Assert
    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})

describe('addSet (user-scoped)', () => {
  it('numbers the new set one past the current max and stamps completion', async () => {
    // Arrange — owned, current max setNumber is 3
    selectQueue = [[{ id: 'ex1' }], [{ value: 3 }]]

    // Act
    const result = await addSet(USER, WID, 0, { reps: 8, weight: 60 })

    // Assert
    expect(records.map((r) => r.op)).toEqual(['insert', 'update:workouts'])
    expect(records[0].values).toEqual({
      workoutExerciseId: 'ex1',
      setNumber: 4,
      reps: 8,
      weight: 60,
      completed: false,
    })
    expect(result).toEqual({ setNumber: 4 })
  })

  it('inserts a checked-off set when the patch says completed', async () => {
    // Arrange
    selectQueue = [[{ id: 'ex1' }], [{ value: 0 }]]

    // Act
    await addSet(USER, WID, 0, { reps: 8, weight: 60, completed: true })

    // Assert
    expect(records[0].values).toMatchObject({ setNumber: 1, completed: true })
  })

  it('numbers the first set 1 when the exercise has none', async () => {
    // Arrange — owned, no existing sets (max is null)
    selectQueue = [[{ id: 'ex1' }], [{ value: null }]]

    // Act
    const result = await addSet(USER, WID, 0, { reps: null, weight: null })

    // Assert
    expect(result).toEqual({ setNumber: 1 })
    expect(records[0]).toMatchObject({ op: 'insert', values: { setNumber: 1 } })
  })

  it('preserves an existing completedAt via coalesce (stamp is not a plain overwrite)', async () => {
    // Arrange
    selectQueue = [[{ id: 'ex1' }], [{ value: 1 }]]

    // Act
    await addSet(USER, WID, 0, { reps: 5, weight: 100 })

    // Assert — the stamp must be a SQL coalesce expression, not a raw Date
    const stamp = (records[1].values as { completedAt: unknown }).completedAt
    expect(stamp).not.toBeInstanceOf(Date)
    expect(stamp).toBeTruthy()
  })

  it('returns null and inserts nothing when not owned', async () => {
    // Arrange
    selectQueue = [[]]

    // Act
    const result = await addSet(USER, WID, 9, { reps: 5, weight: null })

    // Assert
    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})

describe('removeSet (user-scoped)', () => {
  it('deletes the set, renumbers the rest, and stamps completion', async () => {
    // Arrange — owned, a set was deleted
    selectQueue = [[{ id: 'ex1' }]]

    // Act
    const result = await removeSet(USER, WID, 0, 2)

    // Assert — delete, renumber against sets, then the workout completion stamp
    expect(records.map((r) => r.op)).toEqual(['delete', 'update:sets', 'update:workouts'])
    expect(result).toEqual({ removed: true })
  })

  it('returns null and does not renumber when no such set exists', async () => {
    // Arrange — owned, but nothing deleted
    selectQueue = [[{ id: 'ex1' }]]
    deletedSetRows = []

    // Act
    const result = await removeSet(USER, WID, 0, 9)

    // Assert — delete attempted, but no renumber follows
    expect(records.map((r) => r.op)).toEqual(['delete'])
    expect(result).toBeNull()
  })

  it('returns null and deletes nothing when not owned', async () => {
    // Arrange
    selectQueue = [[]]

    // Act
    const result = await removeSet(USER, WID, 0, 1)

    // Assert
    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})

describe('updateWorkoutMeta (user-scoped)', () => {
  it('updates name and startedAt when owned', async () => {
    // Arrange
    ownedWorkoutRows = [{ id: WID }]
    const when = new Date('2026-01-02T00:00:00.000Z')

    // Act
    const result = await updateWorkoutMeta(USER, WID, { name: 'Leg Day', startedAt: when })

    // Assert
    expect(records).toEqual([{ op: 'update:workouts', values: { name: 'Leg Day', startedAt: when } }])
    expect(result).toEqual({ id: WID })
  })

  it('returns null when the patch is empty, without querying', async () => {
    // Act
    const result = await updateWorkoutMeta(USER, WID, {})

    // Assert
    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('returns null when the user does not own the workout', async () => {
    // Arrange
    ownedWorkoutRows = []

    // Act
    const result = await updateWorkoutMeta(USER, WID, { name: 'X' })

    // Assert
    expect(result).toBeNull()
  })

  it('sets and clears the session notes', async () => {
    // Arrange
    ownedWorkoutRows = [{ id: WID }]

    // Act — set, then clear (null)
    await updateWorkoutMeta(USER, WID, { notes: 'felt strong' })
    await updateWorkoutMeta(USER, WID, { notes: null })

    // Assert
    expect(records).toEqual([
      { op: 'update:workouts', values: { notes: 'felt strong' } },
      { op: 'update:workouts', values: { notes: null } },
    ])
  })
})

describe('updateExerciseMeta (user-scoped)', () => {
  it('updates notes and skipped on the owned exercise, with no completion stamp', async () => {
    // Arrange — ownership lookup resolves an exercise
    selectQueue = [[{ id: 'ex1' }]]

    // Act
    const result = await updateExerciseMeta(USER, WID, 0, { notes: 'knee pain', skipped: true })

    // Assert — one targeted write to workout_exercises; workouts untouched
    expect(records).toEqual([
      { op: 'update:workout_exercises', values: { notes: 'knee pain', skipped: true } },
    ])
    expect(result).toEqual({ id: 's9' })
  })

  it('clears notes with an explicit null', async () => {
    // Arrange
    selectQueue = [[{ id: 'ex1' }]]

    // Act
    await updateExerciseMeta(USER, WID, 0, { notes: null })

    // Assert
    expect(records[0]).toEqual({ op: 'update:workout_exercises', values: { notes: null } })
  })

  it('returns null for an empty patch without querying', async () => {
    // Act
    const result = await updateExerciseMeta(USER, WID, 0, {})

    // Assert
    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('returns null and writes nothing when the workout is not owned', async () => {
    // Arrange — ownership lookup finds nothing
    selectQueue = [[]]

    // Act
    const result = await updateExerciseMeta(USER, WID, 0, { skipped: true })

    // Assert — security-critical: no update issued
    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})

describe('patchCanBreakCompletion zero-duration guard (review follow-up)', () => {
  it('a bare durationSec: 0 patch on a completed cardio set is refused, not fast-pathed', async () => {
    // Arrange — stored: completed duration set; patch blanks via zero with no
    // completed/metricMode field, which previously skipped the pre-write read.
    selectQueue = [
      [{ id: 'we1' }],
      [{ completed: true, metricMode: 'duration', weight: null, durationSec: 600 }],
    ]

    // Act + Assert
    await expect(
      updateSet(USER, WID, 0, 1, { durationSec: 0 }),
    ).rejects.toThrow(/duration/)
  })
})
