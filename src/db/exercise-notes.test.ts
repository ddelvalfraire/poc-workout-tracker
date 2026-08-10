import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs for the Drizzle builders, mirroring bodyweight.test.ts /
 * custom-exercises usage: reads resolve `selectRows`, upserts record their
 * values + conflict target and resolve `upsertRows`, deletes resolve
 * `deleteRows` (empty = not owned). The where-condition of each call is
 * captured so owner-scoping can be asserted via the generated SQL.
 */
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

let selectRows: Record<string, unknown>[] = []
let upsertRows: Record<string, unknown>[] = []
let deleteRows: Record<string, unknown>[] = []
const inserts: { values: unknown; conflict: unknown }[] = []
const whereArgs: unknown[] = []

vi.mock('./index', () => ({
  db: {
    select: () => {
      const builder: Record<string, unknown> = {
        from: () => builder,
        where: (cond: unknown) => {
          whereArgs.push(cond)
          return builder
        },
        limit: () => Promise.resolve(selectRows),
        orderBy: () => builder,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(selectRows).then(resolve, reject),
      }
      return builder
    },
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: (c: unknown) => {
          inserts.push({ values: v, conflict: c })
          return { returning: () => Promise.resolve(upsertRows) }
        },
      }),
    }),
    delete: () => ({
      where: (cond: unknown) => {
        whereArgs.push(cond)
        return { returning: () => Promise.resolve(deleteRows) }
      },
    }),
  },
}))

import { getExerciseNote, upsertExerciseNote, deleteExerciseNote } from './exercise-notes'

const USER = 'user_123'

/** Renders a captured Drizzle condition to parameterized SQL for assertions. */
function renderedWhere(index: number): string {
  const dialect = new PgDialect()
  return dialect.sqlToQuery(whereArgs[index] as SQL).sql
}

beforeEach(() => {
  selectRows = []
  upsertRows = []
  deleteRows = []
  inserts.length = 0
  whereArgs.length = 0
})

describe('getExerciseNote', () => {
  it('returns the note row for the composite identity', async () => {
    const row = { userId: USER, source: 'wger', exerciseId: 73, body: 'Seat pin 4', pinned: true }
    selectRows = [row]

    const note = await getExerciseNote(USER, 'wger', 73)

    expect(note).toEqual(row)
    expect(renderedWhere(0)).toContain('user_id')
    expect(renderedWhere(0)).toContain('source')
    expect(renderedWhere(0)).toContain('exercise_id')
  })

  it('returns null when no note exists', async () => {
    selectRows = []
    expect(await getExerciseNote(USER, 'custom', 5)).toBeNull()
  })
})

describe('upsertExerciseNote', () => {
  it('inserts with the identity and updates body/pinned on conflict', async () => {
    upsertRows = [{ userId: USER, source: 'wger', exerciseId: 73, body: 'Pin 4', pinned: true }]

    const row = await upsertExerciseNote(USER, 'wger', 73, { body: 'Pin 4', pinned: true })

    expect(row.body).toBe('Pin 4')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].values).toMatchObject({
      userId: USER,
      source: 'wger',
      exerciseId: 73,
      body: 'Pin 4',
      pinned: true,
    })
    // Conflict target is the composite identity — one note per exercise.
    const conflict = inserts[0].conflict as { target: unknown[]; set: Record<string, unknown> }
    expect(conflict.target).toHaveLength(3)
    expect(conflict.set).toMatchObject({ body: 'Pin 4', pinned: true })
    expect(conflict.set.updatedAt).toBeInstanceOf(Date)
  })

  it('throws when the insert returns no row (impossible-state guard)', async () => {
    upsertRows = []
    await expect(upsertExerciseNote(USER, 'wger', 73, { body: 'x', pinned: false })).rejects.toThrow(
      /no row/,
    )
  })
})

describe('deleteExerciseNote', () => {
  it('returns true when a row was deleted (owner-scoped where)', async () => {
    deleteRows = [{ id: 'n1' }]
    expect(await deleteExerciseNote(USER, 'wger', 73)).toBe(true)
    expect(renderedWhere(0)).toContain('user_id')
  })

  it('returns false when nothing matched (not owned or absent)', async () => {
    deleteRows = []
    expect(await deleteExerciseNote(USER, 'wger', 73)).toBe(false)
  })
})
