import { describe, it, expect, beforeEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  captureAndParkChildNotes,
  fallbackSetNotesBeforeRemoval,
  reattachChildNotes,
  setCanonicalWorkoutNote,
  setCanonicalExerciseNote,
  snapshotMatchesSetRow,
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
        { noteId: 'n1', source: 'wger', wgerExerciseId: 73, setNumber: null, anchorSnapshot: null },
        {
          noteId: 'n2',
          source: 'custom',
          wgerExerciseId: 73,
          setNumber: 2,
          anchorSnapshot: { loadKg: 100, reps: 5 },
        },
      ],
    ]

    const captured = await captureAndParkChildNotes(makeTx() as unknown as Tx, WID)

    expect(captured).toEqual([
      { noteId: 'n1', exerciseKey: 'wger:73', setNumber: null, anchorSnapshot: null },
      {
        noteId: 'n2',
        exerciseKey: 'custom:73',
        setNumber: 2,
        anchorSnapshot: { loadKg: 100, reps: 5 },
      },
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
    setIdByKey: new Map([
      ['wger:73:2', { id: 's-new', weight: 100, reps: 5, durationSec: null }],
    ]),
  }

  it('re-attaches exercise and aligned set notes, grouped per target', async () => {
    const captured: CapturedChildNote[] = [
      { noteId: 'n1', exerciseKey: 'wger:73', setNumber: null, anchorSnapshot: null },
      {
        noteId: 'n2',
        exerciseKey: 'wger:73',
        setNumber: 2,
        anchorSnapshot: { loadKg: 100, reps: 5 },
      },
    ]

    await reattachChildNotes(makeTx() as unknown as Tx, captured, ids, new Set(['wger:73']))

    expect(records).toEqual([
      { op: 'update', values: { workoutId: null, workoutExerciseId: 'e-new' } },
      { op: 'update', values: { workoutId: null, setId: 's-new' } },
    ])
  })

  it('leaves a set note parked when the row at its position carries DIFFERENT content', async () => {
    // The same-count reorder case: the ordinal exists but holds another set.
    const captured: CapturedChildNote[] = [
      {
        noteId: 'n2',
        exerciseKey: 'wger:73',
        setNumber: 2,
        anchorSnapshot: { loadKg: 80, reps: 8 },
      },
    ]

    await reattachChildNotes(makeTx() as unknown as Tx, captured, ids, new Set(['wger:73']))

    expect(records).toEqual([])
  })

  it('leaves set notes parked when their exercise is not aligned (shifted positions)', async () => {
    const captured: CapturedChildNote[] = [
      { noteId: 'n2', exerciseKey: 'wger:73', setNumber: 2, anchorSnapshot: null },
    ]

    await reattachChildNotes(makeTx() as unknown as Tx, captured, ids, new Set())

    expect(records).toEqual([])
  })

  it('leaves notes parked when their exercise identity vanished', async () => {
    const captured: CapturedChildNote[] = [
      { noteId: 'n1', exerciseKey: 'wger:99', setNumber: null, anchorSnapshot: null },
      { noteId: 'n2', exerciseKey: 'wger:99', setNumber: 1, anchorSnapshot: null },
    ]

    await reattachChildNotes(makeTx() as unknown as Tx, captured, ids, new Set(['wger:99']))

    expect(records).toEqual([])
  })
})

describe('snapshotMatchesSetRow', () => {
  const row = { weight: 100, reps: 5, durationSec: null }

  it('matches when recorded facts agree (loads within tolerance)', () => {
    expect(snapshotMatchesSetRow({ loadKg: 100.04, reps: 5 }, row)).toBe(true)
  })

  it('mismatches on a different load or reps', () => {
    expect(snapshotMatchesSetRow({ loadKg: 80 }, row)).toBe(false)
    expect(snapshotMatchesSetRow({ reps: 8 }, row)).toBe(false)
  })

  it('treats null/absent snapshot fields as wildcards (note on a not-yet-typed set)', () => {
    expect(snapshotMatchesSetRow({ loadKg: null, reps: null, setNumber: 2 }, row)).toBe(true)
    expect(snapshotMatchesSetRow(null, row)).toBe(true)
  })

  it('compares duration for timed sets', () => {
    expect(snapshotMatchesSetRow({ durationSec: 45 }, { weight: null, reps: null, durationSec: 45 })).toBe(true)
    expect(snapshotMatchesSetRow({ durationSec: 45 }, { weight: null, reps: null, durationSec: 60 })).toBe(false)
  })
})

describe('fallbackSetNotesBeforeRemoval', () => {
  it('re-anchors the doomed set\'s notes to the workout, snapshot coalesced in', async () => {
    await fallbackSetNotesBeforeRemoval(makeTx() as unknown as Tx, WID, {
      id: 's7',
      setNumber: 2,
      exerciseName: 'Squat',
      weight: 100,
      reps: 5,
      durationSec: null,
    })

    expect(records).toHaveLength(1)
    const values = records[0].values as Record<string, unknown>
    expect(values).toMatchObject({ workoutId: WID, setId: null })
    // The snapshot write is a coalesce (existing snapshot always wins) — a
    // SQL expression, not a plain object overwrite.
    expect(values.anchorSnapshot).toBeTruthy()
    expect(values.anchorSnapshot).not.toEqual(expect.objectContaining({ exerciseName: 'Squat' }))
    // …and the where targets exactly that set's notes.
    expect(renderedWhere(0)).toContain('set_id')
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
