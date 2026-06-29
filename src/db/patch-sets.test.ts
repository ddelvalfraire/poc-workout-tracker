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

import { updateSet, addSet, removeSet, updateWorkoutMeta } from './workouts'

const USER = 'user_123'
const WID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  records.length = 0
  selectQueue = []
  updatedSetRows = [{ id: 's9' }]
  deletedSetRows = [{ id: 's9' }]
  ownedWorkoutRows = [{ id: 'w1' }]
})

describe('updateSet (user-scoped)', () => {
  it('updates only the addressed set when the workout is owned', async () => {
    // Arrange — ownership lookup resolves an exercise
    selectQueue = [[{ id: 'ex1' }]]

    // Act
    const result = await updateSet(USER, WID, 0, 3, { reps: 5, weight: 100 })

    // Assert
    expect(records).toEqual([{ op: 'update:sets', values: { reps: 5, weight: 100 } }])
    expect(result).toEqual({ id: 's9' })
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
  it('numbers the new set one past the current max', async () => {
    // Arrange — owned, current max setNumber is 3
    selectQueue = [[{ id: 'ex1' }], [{ value: 3 }]]

    // Act
    const result = await addSet(USER, WID, 0, { reps: 8, weight: 60 })

    // Assert
    expect(records).toEqual([
      { op: 'insert', values: { workoutExerciseId: 'ex1', setNumber: 4, reps: 8, weight: 60 } },
    ])
    expect(result).toEqual({ setNumber: 4 })
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
  it('deletes the set then renumbers the higher sets down by one', async () => {
    // Arrange — owned, a set was deleted
    selectQueue = [[{ id: 'ex1' }]]

    // Act
    const result = await removeSet(USER, WID, 0, 2)

    // Assert — delete first, then a renumber update against the sets table
    expect(records.map((r) => r.op)).toEqual(['delete', 'update:sets'])
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
})
