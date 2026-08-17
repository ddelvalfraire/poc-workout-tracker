import { describe, it, expect, beforeEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  captureAndParkChildNotes,
  reattachChildNotes,
  setCanonicalWorkoutNote,
  setCanonicalExerciseNote,
  type CapturedChildNote,
  type InsertedChildIds,
} from './note-sync'

/**
 * Recording tx stub (the update-workout idiom): selects consume a queue,
 * updates/deletes/inserts record their values; where-conditions are captured
 * so scoping can be asserted via rendered SQL. These tests pin the pieces the
 * updateWorkout integration tests don't: canonical-note selection semantics
 * (fallback rows excluded, no-churn updates) and the park/re-attach grouping.
 */
const records: { op: string; values?: unknown }[] = []
let selectQueue: unknown[][] = []
const whereArgs: unknown[] = []

function makeTx() {
  return {
    select: () => {
      const rows = selectQueue.shift() ?? []
      const chain: Record<string, unknown> = {
        from: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: (cond: unknown) => {
          whereArgs.push(cond)
          return chain
        },
        orderBy: () => chain,
        limit: () => chain,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      }
      return chain
    },
    update: () => ({
      set: (values: unknown) => ({
        where: (cond: unknown) => {
          records.push({ op: 'update', values })
          whereArgs.push(cond)
          return Promise.resolve()
        },
      }),
    }),
    delete: () => ({
      where: (cond: unknown) => {
        records.push({ op: 'delete' })
        whereArgs.push(cond)
        return Promise.resolve()
      },
    }),
    insert: () => ({
      values: (values: unknown) => {
        records.push({ op: 'insert', values })
        return Promise.resolve()
      },
    }),
  }
}

type Tx = Parameters<typeof captureAndParkChildNotes>[0]

const USER = 'user_123'
const WID = '11111111-1111-1111-1111-111111111111'

function renderedWhere(index: number): string {
  return new PgDialect().sqlToQuery(whereArgs[index] as SQL).sql
}

beforeEach(() => {
  records.length = 0
  selectQueue = []
  whereArgs.length = 0
})

describe('captureAndParkChildNotes', () => {
  it('parks captured notes on the workout anchor and returns identity keys', async () => {
    selectQueue = [
      [
        { noteId: 'n1', source: 'wger', wgerExerciseId: 73, setNumber: null },
        { noteId: 'n2', source: 'custom', wgerExerciseId: 73, setNumber: 2 },
      ],
    ]

    const captured = await captureAndParkChildNotes(makeTx() as unknown as Tx, WID)

    expect(captured).toEqual([
      { noteId: 'n1', exerciseKey: 'wger:73', setNumber: null },
      { noteId: 'n2', exerciseKey: 'custom:73', setNumber: 2 },
    ])
    // The park update swaps every anchor to the workout, snapshot untouched.
    expect(records).toEqual([
      { op: 'update', values: { workoutId: WID, workoutExerciseId: null, setId: null } },
    ])
  })

  it('does nothing when the workout has no child-anchored notes', async () => {
    selectQueue = [[]]
    const captured = await captureAndParkChildNotes(makeTx() as unknown as Tx, WID)
    expect(captured).toEqual([])
    expect(records).toEqual([])
  })
})

describe('reattachChildNotes', () => {
  const ids: InsertedChildIds = {
    exerciseIdByKey: new Map([['wger:73', 'e-new']]),
    setIdByKey: new Map([['wger:73:2', 's-new']]),
  }

  it('re-attaches exercise and aligned set notes, grouped per target', async () => {
    const captured: CapturedChildNote[] = [
      { noteId: 'n1', exerciseKey: 'wger:73', setNumber: null },
      { noteId: 'n2', exerciseKey: 'wger:73', setNumber: 2 },
    ]

    await reattachChildNotes(makeTx() as unknown as Tx, captured, ids, new Set(['wger:73']))

    expect(records).toEqual([
      { op: 'update', values: { workoutId: null, workoutExerciseId: 'e-new' } },
      { op: 'update', values: { workoutId: null, setId: 's-new' } },
    ])
  })

  it('leaves set notes parked when their exercise is not aligned (shifted positions)', async () => {
    const captured: CapturedChildNote[] = [{ noteId: 'n2', exerciseKey: 'wger:73', setNumber: 2 }]

    await reattachChildNotes(makeTx() as unknown as Tx, captured, ids, new Set())

    expect(records).toEqual([])
  })

  it('leaves notes parked when their exercise identity vanished', async () => {
    const captured: CapturedChildNote[] = [
      { noteId: 'n1', exerciseKey: 'wger:99', setNumber: null },
      { noteId: 'n2', exerciseKey: 'wger:99', setNumber: 1 },
    ]

    await reattachChildNotes(makeTx() as unknown as Tx, captured, ids, new Set(['wger:99']))

    expect(records).toEqual([])
  })
})

describe('setCanonicalWorkoutNote', () => {
  it('excludes fallback re-anchors from the canonical lookup (snapshot IS NULL)', async () => {
    selectQueue = [[]]
    await setCanonicalWorkoutNote(makeTx() as unknown as Tx, USER, WID, 'good session')
    expect(renderedWhere(0)).toContain('"anchor_snapshot" is null')
    expect(renderedWhere(0)).toContain('author')
    expect(records).toEqual([
      {
        op: 'insert',
        values: { userId: USER, author: 'user', body: 'good session', workoutId: WID },
      },
    ])
  })

  it('updates the existing canonical row when the body changed', async () => {
    selectQueue = [[{ id: 'n1', body: 'old words' }]]
    await setCanonicalWorkoutNote(makeTx() as unknown as Tx, USER, WID, 'new words')
    expect(records).toHaveLength(1)
    expect(records[0].op).toBe('update')
    expect(records[0].values).toMatchObject({ body: 'new words' })
  })

  it('does not churn updatedAt when the round-tripped body is unchanged', async () => {
    selectQueue = [[{ id: 'n1', body: 'same words' }]]
    await setCanonicalWorkoutNote(makeTx() as unknown as Tx, USER, WID, 'same words')
    expect(records).toEqual([])
  })

  it('deletes the canonical row on a null body and no-ops when none exists', async () => {
    selectQueue = [[{ id: 'n1', body: 'x' }]]
    await setCanonicalWorkoutNote(makeTx() as unknown as Tx, USER, WID, null)
    expect(records).toEqual([{ op: 'delete' }])

    records.length = 0
    selectQueue = [[]]
    await setCanonicalWorkoutNote(makeTx() as unknown as Tx, USER, WID, null)
    expect(records).toEqual([])
  })
})

describe('setCanonicalExerciseNote', () => {
  it('creates a new instance note with the {exerciseName} snapshot', async () => {
    selectQueue = [[]]
    await setCanonicalExerciseNote(makeTx() as unknown as Tx, USER, 'we-1', 'Squat', 'felt heavy')
    expect(records).toEqual([
      {
        op: 'insert',
        values: {
          userId: USER,
          author: 'user',
          body: 'felt heavy',
          workoutExerciseId: 'we-1',
          anchorSnapshot: { exerciseName: 'Squat' },
        },
      },
    ])
  })
})
