import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs for the Drizzle builders, mirroring exercise-notes.test.ts:
 * each db.select() consumes the next entry of `selectResults` (queries run in
 * a fixed order per op), inserts/updates/deletes record their values and
 * resolve the configured rows. Where-conditions are captured and rendered to
 * SQL so owner-scoping and join-chain ownership can be asserted.
 */
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

let selectResults: Record<string, unknown>[][] = []
let insertRows: Record<string, unknown>[] = []
let updateRows: Record<string, unknown>[] = []
let deleteRows: Record<string, unknown>[] = []
const inserts: unknown[] = []
const updates: unknown[] = []
const whereArgs: unknown[] = []
const limits: number[] = []

vi.mock('./index', () => ({
  db: {
    select: () => {
      const rows = selectResults.shift() ?? []
      const builder: Record<string, unknown> = {
        from: () => builder,
        innerJoin: () => builder,
        leftJoin: () => builder,
        where: (cond: unknown) => {
          whereArgs.push(cond)
          return builder
        },
        orderBy: () => builder,
        limit: (n: number) => {
          limits.push(n)
          return builder
        },
        offset: () => builder,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      }
      return builder
    },
    insert: () => ({
      values: (v: unknown) => {
        inserts.push(v)
        return { returning: () => Promise.resolve(insertRows) }
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        updates.push(v)
        return {
          where: (cond: unknown) => {
            whereArgs.push(cond)
            return { returning: () => Promise.resolve(updateRows) }
          },
        }
      },
    }),
    delete: () => ({
      where: (cond: unknown) => {
        whereArgs.push(cond)
        return { returning: () => Promise.resolve(deleteRows) }
      },
    }),
  },
}))

import {
  createNote,
  updateNote,
  deleteNote,
  listNotes,
  notesForWorkout,
  noteAnchorKind,
} from './notes'

const USER = 'user_123'
const ANCHOR_ID = '01234567-89ab-cdef-0123-456789abcdef'

function renderedWhere(index: number): string {
  const dialect = new PgDialect()
  return dialect.sqlToQuery(whereArgs[index] as SQL).sql
}

beforeEach(() => {
  selectResults = []
  insertRows = []
  updateRows = []
  deleteRows = []
  inserts.length = 0
  updates.length = 0
  whereArgs.length = 0
  limits.length = 0
})

describe('noteAnchorKind', () => {
  it('derives the kind from the one non-null FK', () => {
    const base = { programId: null, workoutId: null, workoutExerciseId: null, setId: null }
    expect(noteAnchorKind({ ...base, setId: 's1' })).toBe('set')
    expect(noteAnchorKind({ ...base, workoutExerciseId: 'we1' })).toBe('workout_exercise')
    expect(noteAnchorKind({ ...base, workoutId: 'w1' })).toBe('workout')
    expect(noteAnchorKind({ ...base, programId: 'p1' })).toBe('program')
  })
})

describe('createNote', () => {
  it('creates a workout-anchored note with no snapshot', async () => {
    selectResults = [[{ id: ANCHOR_ID }]] // ownership read
    insertRows = [{ id: 'n1', body: 'good session' }]

    const row = await createNote(USER, { kind: 'workout', id: ANCHOR_ID }, 'good session')

    expect(row).toEqual({ id: 'n1', body: 'good session' })
    expect(renderedWhere(0)).toContain('user_id') // ownership gate
    expect(inserts[0]).toMatchObject({
      userId: USER,
      author: 'user',
      body: 'good session',
      workoutId: ANCHOR_ID,
    })
    expect(inserts[0]).not.toHaveProperty('anchorSnapshot')
  })

  it('stamps the frozen snapshot for a set anchor from the anchor row', async () => {
    selectResults = [
      [{ exerciseName: 'Bench Press', setNumber: 3, loadKg: 100, reps: 8, durationSec: null }],
    ]
    insertRows = [{ id: 'n2' }]

    await createNote(USER, { kind: 'set', id: ANCHOR_ID }, 'shoulder clicked')

    expect(inserts[0]).toMatchObject({
      setId: ANCHOR_ID,
      anchorSnapshot: {
        exerciseName: 'Bench Press',
        setNumber: 3,
        loadKg: 100,
        reps: 8,
        durationSec: null,
      },
    })
  })

  it('stamps the exercise-name snapshot for an exercise anchor', async () => {
    selectResults = [[{ exerciseName: 'Squat' }]]
    insertRows = [{ id: 'n3' }]

    await createNote(USER, { kind: 'workout_exercise', id: ANCHOR_ID }, 'felt heavy')

    expect(inserts[0]).toMatchObject({
      workoutExerciseId: ANCHOR_ID,
      anchorSnapshot: { exerciseName: 'Squat' },
    })
  })

  it('stores the coach author when passed', async () => {
    selectResults = [[{ id: ANCHOR_ID }]]
    insertRows = [{ id: 'n4' }]

    await createNote(USER, { kind: 'program', id: ANCHOR_ID }, 'week 2 looks solid', {
      author: 'coach',
    })

    expect(inserts[0]).toMatchObject({ author: 'coach', programId: ANCHOR_ID })
  })

  it('returns null (no insert) when the anchor is not owned', async () => {
    selectResults = [[]]
    expect(await createNote(USER, { kind: 'workout', id: ANCHOR_ID }, 'x')).toBeNull()
    expect(inserts).toHaveLength(0)
  })
})

describe('updateNote', () => {
  it("updates only the user's OWN user-authored note", async () => {
    updateRows = [{ id: 'n1', body: 'edited' }]

    const row = await updateNote(USER, 'n1', 'edited')

    expect(row).toEqual({ id: 'n1', body: 'edited' })
    expect(updates[0]).toMatchObject({ body: 'edited' })
    expect((updates[0] as { updatedAt: unknown }).updatedAt).toBeInstanceOf(Date)
    expect(renderedWhere(0)).toContain('user_id')
    expect(renderedWhere(0)).toContain('author')
  })

  it('returns null when nothing matched (absent, foreign, or coach-authored)', async () => {
    updateRows = []
    expect(await updateNote(USER, 'n9', 'x')).toBeNull()
  })
})

describe('deleteNote', () => {
  it('deletes owner-scoped and reports whether a row died', async () => {
    deleteRows = [{ id: 'n1' }]
    expect(await deleteNote(USER, 'n1')).toBe(true)
    expect(renderedWhere(0)).toContain('user_id')

    deleteRows = []
    expect(await deleteNote(USER, 'n1')).toBe(false)
  })
})

describe('listNotes', () => {
  it('scopes by user and maps rows with their anchor kind', async () => {
    selectResults = [
      [
        {
          id: 'n1',
          author: 'user',
          body: 'x',
          programId: null,
          workoutId: null,
          workoutExerciseId: null,
          setId: 's1',
          anchorSnapshot: { setNumber: 3 },
          createdAt: new Date('2026-08-01T00:00:00Z'),
          updatedAt: new Date('2026-08-01T00:00:00Z'),
          workoutName: 'Push Day',
          workoutStartedAt: new Date('2026-08-01T00:00:00Z'),
          exerciseName: 'Bench Press',
          setNumber: 3,
          programName: null,
        },
      ],
    ]

    const rows = await listNotes(USER)

    expect(rows).toHaveLength(1)
    expect(rows[0].anchorKind).toBe('set')
    expect(rows[0].workoutName).toBe('Push Day')
    expect(renderedWhere(0)).toContain('user_id')
  })

  it('applies anchor-kind and id filters in the where', async () => {
    selectResults = [[]]
    await listNotes(USER, { anchorKind: 'workout', workoutId: ANCHOR_ID })
    expect(renderedWhere(0)).toContain('workout_id')
  })

  it('caps the limit at the ceiling', async () => {
    selectResults = [[]]
    await listNotes(USER, { limit: 10_000 })
    expect(limits[0]).toBe(200)
  })
})

describe('notesForWorkout', () => {
  it('scopes by user and the resolved workout id', async () => {
    selectResults = [[]]
    await notesForWorkout(USER, ANCHOR_ID)
    expect(renderedWhere(0)).toContain('user_id')
    expect(renderedWhere(0)).toContain('"workouts"."id"')
  })
})
