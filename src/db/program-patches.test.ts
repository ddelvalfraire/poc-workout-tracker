import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTableName, type Table } from 'drizzle-orm'

/**
 * Chain-recording mock for the program patch ops — the program twin of
 * `patch-sets.test.ts`. `selectQueue` feeds each op's reads in call order (the
 * expected order is documented per test); `records` captures every write as
 * `insert:<table>` / `update:<table>` / `delete:<table>` so a test can assert
 * WHICH table a renumber or bump hit; the *Rows vars toggle the returning
 * outcomes to drive the owned/found gates without a database.
 */
const records: { op: string; values?: unknown }[] = []
let selectQueue: unknown[][] = []
let updatedRows: { id: string }[] = [{ id: 'row1' }]
let deletedRows: { id: string }[] = [{ id: 'ps1' }]
let insertedRows: { id: string }[] = [{ id: 'pe-new' }]

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

// Derive the real table name from the arg so a test asserts WHICH table a write
// targeted (e.g. the set renumber must hit `program_sets`, the bump `programs`).
function updateChain(table: unknown) {
  const name = getTableName(table as Table)
  const obj = {
    set: (values: unknown) => {
      records.push({ op: `update:${name}`, values })
      return obj
    },
    where: () => obj,
    returning: () => ({ then: (resolve: Resolve) => Promise.resolve(updatedRows).then(resolve) }),
    // The renumber/bump paths await .where() directly (no .returning()).
    then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
  }
  return obj
}

function deleteChain(table: unknown) {
  const name = getTableName(table as Table)
  records.push({ op: `delete:${name}` })
  const obj = {
    where: () => obj,
    returning: () => ({ then: (resolve: Resolve) => Promise.resolve(deletedRows).then(resolve) }),
    // Day/exercise deletes await .where() directly (no .returning()).
    then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
  }
  return obj
}

function insertChain(table: unknown) {
  const name = getTableName(table as Table)
  return {
    values: (values: unknown) => {
      records.push({ op: `insert:${name}`, values })
      return {
        returning: () => ({
          then: (resolve: Resolve) => Promise.resolve(insertedRows).then(resolve),
        }),
        then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
      }
    },
  }
}

function makeTx() {
  return {
    select: () => selectChain(),
    update: (table: unknown) => updateChain(table),
    delete: (table: unknown) => deleteChain(table),
    insert: (table: unknown) => insertChain(table),
  }
}

vi.mock('./index', () => ({
  db: {
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
  },
}))

import {
  ProgramPatchError,
  addProgramDay,
  updateProgramDay,
  removeProgramDay,
  moveProgramDay,
  addProgramExercise,
  updateProgramExercise,
  removeProgramExercise,
  moveProgramExercise,
  addProgramSet,
  updateProgramSet,
  removeProgramSet,
  moveProgramSet,
} from './program-patches'

const USER = 'user_123'
const PID = '22222222-2222-4222-8222-222222222222'
const OWNED_DAY = [{ id: 'pd1' }]
const OWNED_EXERCISE = [{ exerciseId: 'pe1', dayId: 'pd1' }]
/** A stored reps_weight set row, as updateProgramSet's current-row read returns it. */
const CURRENT_SET = {
  setType: 'working',
  metricMode: 'reps_weight',
  repMin: 5,
  repMax: 12,
  rir: null,
  rpe: null,
  suggestedLoadKg: 100,
  tempo: null,
  durationSec: null,
  distanceM: null,
  technique: null,
}

beforeEach(() => {
  records.length = 0
  selectQueue = []
  updatedRows = [{ id: 'row1' }]
  deletedRows = [{ id: 'ps1' }]
  insertedRows = [{ id: 'pe-new' }]
})

describe('day ops (user-scoped)', () => {
  it('addProgramDay appends at max(position)+1 and bumps updatedAt', async () => {
    // Reads: owned-program → max(position)
    selectQueue = [[{ id: PID }], [{ value: 1 }]]

    const result = await addProgramDay(USER, PID, { name: 'Pull', notes: null })

    expect(records.map((r) => r.op)).toEqual(['insert:program_days', 'update:programs'])
    expect(records[0]!.values).toMatchObject({ programId: PID, name: 'Pull', position: 2 })
    expect(result).toEqual({ position: 2 })
  })

  it('addProgramDay starts at position 0 when the program has no days', async () => {
    // Reads: owned-program → max(position) (null = empty)
    selectQueue = [[{ id: PID }], [{ value: null }]]

    const result = await addProgramDay(USER, PID, { name: 'Push' })

    expect(result).toEqual({ position: 0 })
    expect(records[0]).toMatchObject({ op: 'insert:program_days', values: { position: 0 } })
  })

  it('addProgramDay returns null and writes nothing when the program is not owned', async () => {
    selectQueue = [[]]

    const result = await addProgramDay(USER, PID, { name: 'Push' })

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('updateProgramDay patches only the named fields and bumps updatedAt', async () => {
    // Reads: owned-day
    selectQueue = [OWNED_DAY]

    const result = await updateProgramDay(USER, PID, 0, { name: 'Legs' })

    expect(records.map((r) => r.op)).toEqual(['update:program_days', 'update:programs'])
    expect(records[0]!.values).toEqual({ name: 'Legs' })
    expect(result).toEqual({ id: 'row1' })
  })

  it('updateProgramDay returns null for an empty patch without querying', async () => {
    const result = await updateProgramDay(USER, PID, 0, {})

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('updateProgramDay returns null and writes nothing when not owned', async () => {
    selectQueue = [[]]

    const result = await updateProgramDay(USER, PID, 0, { name: 'Legs' })

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('removeProgramDay deletes the day then closes the position gap', async () => {
    // Reads: owned-day
    selectQueue = [OWNED_DAY]

    const result = await removeProgramDay(USER, PID, 1)

    expect(records.map((r) => r.op)).toEqual([
      'delete:program_days',
      'update:program_days',
      'update:programs',
    ])
    expect(result).toEqual({ removed: true })
  })

  it('moveProgramDay splices the block and re-positions the moved day (from > to)', async () => {
    // Reads: owned-day-at-from → day-exists-at-to
    selectQueue = [[{ id: 'pd3' }], [{ id: 'pd1' }]]

    const result = await moveProgramDay(USER, PID, 2, 0)

    // Shift [0,2) up by one, then drop the moved day at 0, then bump.
    expect(records.map((r) => r.op)).toEqual([
      'update:program_days',
      'update:program_days',
      'update:programs',
    ])
    expect(records[1]!.values).toEqual({ position: 0 })
    expect(result).toEqual({ moved: true })
  })

  it('moveProgramDay is a no-op success when from === to', async () => {
    // Reads: owned-day-at-from only
    selectQueue = [OWNED_DAY]

    const result = await moveProgramDay(USER, PID, 1, 1)

    expect(result).toEqual({ moved: true })
    expect(records).toEqual([])
  })

  it('moveProgramDay returns null when no day sits at the target position', async () => {
    // Reads: owned-day-at-from → (empty) day-exists-at-to
    selectQueue = [OWNED_DAY, []]

    const result = await moveProgramDay(USER, PID, 0, 9)

    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})

describe('exercise ops (user-scoped)', () => {
  it('addProgramExercise appends the exercise and seeds one default set', async () => {
    // Reads: owned-day → max(position)
    selectQueue = [OWNED_DAY, [{ value: null }]]

    const result = await addProgramExercise(USER, PID, 0, {
      wgerExerciseId: 73,
      name: 'Flat Bench',
    })

    expect(records.map((r) => r.op)).toEqual([
      'insert:program_exercises',
      'insert:program_sets',
      'update:programs',
    ])
    expect(records[0]!.values).toMatchObject({
      programDayId: 'pd1',
      name: 'Flat Bench',
      position: 0,
    })
    expect(records[1]!.values).toMatchObject({
      programExerciseId: 'pe-new',
      setNumber: 1,
      setType: 'working',
      metricMode: 'reps_weight',
    })
    expect(result).toEqual({ position: 0 })
  })

  it('addProgramExercise rejects a malformed progression before any read', async () => {
    await expect(
      addProgramExercise(USER, PID, 0, {
        wgerExerciseId: 73,
        name: 'Bench',
        // @ts-expect-error — deliberately malformed scheme
        progression: { scheme: 'bogus' },
      }),
    ).rejects.toBeInstanceOf(ProgramPatchError)
    expect(records).toEqual([])
  })

  it('addProgramExercise returns null and writes nothing when the day is not owned', async () => {
    selectQueue = [[]]

    const result = await addProgramExercise(USER, PID, 0, { wgerExerciseId: 73, name: 'Bench' })

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('updateProgramExercise patches the named fields and bumps updatedAt', async () => {
    // Reads: owned-exercise
    selectQueue = [OWNED_EXERCISE]

    const result = await updateProgramExercise(USER, PID, 1, 0, {
      wgerExerciseId: 99,
      name: 'Incline Press',
    })

    expect(records.map((r) => r.op)).toEqual(['update:program_exercises', 'update:programs'])
    expect(records[0]!.values).toEqual({ wgerExerciseId: 99, name: 'Incline Press' })
    expect(result).toEqual({ id: 'row1' })
  })

  it('updateProgramExercise clears progression with an explicit null', async () => {
    // Reads: owned-exercise
    selectQueue = [OWNED_EXERCISE]

    await updateProgramExercise(USER, PID, 0, 0, { progression: null })

    expect(records[0]!.values).toEqual({ progression: null })
  })

  it('updateProgramExercise returns null and writes nothing when not owned', async () => {
    selectQueue = [[]]

    const result = await updateProgramExercise(USER, PID, 0, 0, { name: 'X' })

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('removeProgramExercise deletes then renumbers within its day', async () => {
    // Reads: owned-exercise
    selectQueue = [OWNED_EXERCISE]

    const result = await removeProgramExercise(USER, PID, 0, 1)

    expect(records.map((r) => r.op)).toEqual([
      'delete:program_exercises',
      'update:program_exercises',
      'update:programs',
    ])
    expect(result).toEqual({ removed: true })
  })

  it('moveProgramExercise splices within the day (from < to)', async () => {
    // Reads: owned-exercise-at-from → exercise-exists-at-to
    selectQueue = [OWNED_EXERCISE, [{ id: 'pe2' }]]

    const result = await moveProgramExercise(USER, PID, 0, 0, 2)

    // Shift (0,2] down by one, then drop the moved exercise at 2, then bump.
    expect(records.map((r) => r.op)).toEqual([
      'update:program_exercises',
      'update:program_exercises',
      'update:programs',
    ])
    expect(records[1]!.values).toEqual({ position: 2 })
    expect(result).toEqual({ moved: true })
  })
})

describe('set ops (user-scoped)', () => {
  it('addProgramSet appends at max(setNumber)+1', async () => {
    // Reads: owned-exercise → max(setNumber)
    selectQueue = [OWNED_EXERCISE, [{ value: 3 }]]

    const result = await addProgramSet(USER, PID, 0, 0, { repMin: 8, repMax: 10 })

    expect(records.map((r) => r.op)).toEqual(['insert:program_sets', 'update:programs'])
    expect(records[0]!.values).toMatchObject({
      programExerciseId: 'pe1',
      setNumber: 4,
      setType: 'working',
      metricMode: 'reps_weight',
      repMin: 8,
      repMax: 10,
    })
    expect(result).toEqual({ setNumber: 4 })
  })

  it('addProgramSet rejects a timed set without durationSec before any read', async () => {
    await expect(addProgramSet(USER, PID, 0, 0, { metricMode: 'duration' })).rejects.toThrow(
      /durationSec/,
    )
    expect(records).toEqual([])
  })

  it('updateProgramSet merges the patch over the stored row and updates', async () => {
    // Reads: owned-exercise → current set row
    selectQueue = [OWNED_EXERCISE, [CURRENT_SET]]

    const result = await updateProgramSet(USER, PID, 0, 0, 3, { repMin: 8 })

    expect(records.map((r) => r.op)).toEqual(['update:program_sets', 'update:programs'])
    expect(records[0]!.values).toEqual({ repMin: 8 })
    expect(result).toEqual({ id: 'row1' })
  })

  it('updateProgramSet rejects metricMode duration when the merged row has no durationSec', async () => {
    // Reads: owned-exercise → current set row (a reps_weight row, durationSec null)
    selectQueue = [OWNED_EXERCISE, [CURRENT_SET]]

    await expect(updateProgramSet(USER, PID, 0, 0, 1, { metricMode: 'duration' })).rejects.toThrow(
      /durationSec is required/,
    )
    expect(records).toEqual([])
  })

  it('updateProgramSet rejects repMin > repMax after the merge', async () => {
    // Reads: owned-exercise → current set row (repMax 12)
    selectQueue = [OWNED_EXERCISE, [CURRENT_SET]]

    await expect(updateProgramSet(USER, PID, 0, 0, 1, { repMin: 15 })).rejects.toThrow(
      /repMin must be less than or equal to repMax/,
    )
    expect(records).toEqual([])
  })

  it('updateProgramSet re-parses a technique on a partial edit and rejects a bad kind', async () => {
    await expect(
      updateProgramSet(USER, PID, 0, 0, 1, {
        // @ts-expect-error — deliberately malformed kind
        technique: { kind: 'bogus', stages: [{ reps: 5 }] },
      }),
    ).rejects.toBeInstanceOf(ProgramPatchError)
    expect(records).toEqual([])
  })

  it('updateProgramSet returns null for an empty patch without querying', async () => {
    const result = await updateProgramSet(USER, PID, 0, 0, 1, {})

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('updateProgramSet returns null and writes nothing when not owned', async () => {
    selectQueue = [[]]

    const result = await updateProgramSet(USER, PID, 0, 0, 1, { repMin: 8 })

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('removeProgramSet deletes then renumbers the higher program_sets down', async () => {
    // Reads: owned-exercise → count(sets) (4 sets, removing #2)
    selectQueue = [OWNED_EXERCISE, [{ value: 4 }]]

    const result = await removeProgramSet(USER, PID, 0, 0, 2)

    expect(records.map((r) => r.op)).toEqual([
      'delete:program_sets',
      'update:program_sets',
      'update:programs',
    ])
    expect(result).toEqual({ removed: true })
  })

  it("removeProgramSet refuses to delete an exercise's last set", async () => {
    // Reads: owned-exercise → count(sets) (only one set)
    selectQueue = [OWNED_EXERCISE, [{ value: 1 }]]

    await expect(removeProgramSet(USER, PID, 0, 0, 1)).rejects.toThrow(/at least one set/)
    expect(records).toEqual([])
  })

  it('removeProgramSet returns null for a set number past the count', async () => {
    // Reads: owned-exercise → count(sets)
    selectQueue = [OWNED_EXERCISE, [{ value: 2 }]]

    const result = await removeProgramSet(USER, PID, 0, 0, 9)

    expect(result).toBeNull()
    expect(records).toEqual([])
  })

  it('moveProgramSet splices the block and renumbers the moved set (from < to)', async () => {
    // Reads: owned-exercise → set-id-at-from → set-exists-at-to
    selectQueue = [OWNED_EXERCISE, [{ id: 'ps1' }], [{ id: 'ps3' }]]

    const result = await moveProgramSet(USER, PID, 0, 0, 1, 3)

    // Shift (1,3] down by one, then drop the moved set at 3, then bump.
    expect(records.map((r) => r.op)).toEqual([
      'update:program_sets',
      'update:program_sets',
      'update:programs',
    ])
    expect(records[1]!.values).toEqual({ setNumber: 3 })
    expect(result).toEqual({ moved: true })
  })

  it('moveProgramSet returns null and writes nothing when not owned', async () => {
    selectQueue = [[]]

    const result = await moveProgramSet(USER, PID, 0, 0, 1, 2)

    expect(result).toBeNull()
    expect(records).toEqual([])
  })
})
