import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs for the Drizzle query builders, mirroring preferences.test.ts.
 *
 * Reads: `db.select().from().where().orderBy()` resolves to `selectRows`, a
 * controllable array the test sets per-case.
 * Writes: `db.insert().values(v).returning()` records `v` and resolves
 * `insertReturning`; `db.update().set(v).where().returning()` records `v` and
 * resolves `updateReturning` — so tests assert WHAT was written without a real
 * database.
 */
let selectRows: unknown[] = []
let insertReturning: unknown[] = []
let updateReturning: unknown[] = []
const inserts: unknown[] = []
const updates: unknown[] = []

function makeSelectBuilder() {
  const builder = {
    from: () => builder,
    where: () => builder,
    orderBy: () => Promise.resolve(selectRows),
  }
  return builder
}

function makeInsertBuilder() {
  return {
    values: (v: unknown) => {
      inserts.push(v)
      return { returning: () => Promise.resolve(insertReturning) }
    },
  }
}

function makeUpdateBuilder() {
  return {
    set: (v: unknown) => {
      updates.push(v)
      return {
        where: () => ({ returning: () => Promise.resolve(updateReturning) }),
      }
    },
  }
}

vi.mock('./index', () => ({
  db: {
    select: () => makeSelectBuilder(),
    insert: () => makeInsertBuilder(),
    update: () => makeUpdateBuilder(),
  },
}))

import {
  listCustomExercises,
  createCustomExercise,
  updateCustomExercise,
} from './custom-exercises'

const USER = 'user_123'

const INPUT = {
  name: 'Nordic Curl',
  category: 'Legs' as const,
  muscles: ['Hamstrings'],
}

beforeEach(() => {
  selectRows = []
  insertReturning = []
  updateReturning = []
  inserts.length = 0
  updates.length = 0
})

describe('listCustomExercises', () => {
  it('returns the resolved rows', async () => {
    const rows = [{ id: 1, userId: USER, name: 'Nordic Curl' }]
    selectRows = rows
    expect(await listCustomExercises(USER)).toEqual(rows)
  })
})

describe('createCustomExercise', () => {
  it('stamps the owner and defaults omitted optionals to null', async () => {
    insertReturning = [{ id: 1 }]

    await createCustomExercise(USER, INPUT)

    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toEqual({
      userId: USER,
      name: 'Nordic Curl',
      category: 'Legs',
      equipment: null,
      muscles: ['Hamstrings'],
      musclesSecondary: null,
    })
  })

  it('returns the inserted row from returning()', async () => {
    const row = { id: 7, userId: USER, name: 'Nordic Curl' }
    insertReturning = [row]

    expect(await createCustomExercise(USER, INPUT)).toEqual(row)
  })

  it('throws a clear error if the insert returns no row', async () => {
    insertReturning = []

    await expect(createCustomExercise(USER, INPUT)).rejects.toThrow(
      /insert returned no row/,
    )
  })
})

describe('updateCustomExercise', () => {
  it('returns the updated row and refreshes updatedAt when owned', async () => {
    const row = { id: 7, userId: USER, name: 'Nordic Curl' }
    updateReturning = [row]

    expect(await updateCustomExercise(USER, 7, INPUT)).toEqual(row)

    expect(updates).toHaveLength(1)
    const set = updates[0] as Record<string, unknown>
    expect(set).toMatchObject({
      name: 'Nordic Curl',
      category: 'Legs',
      equipment: null,
      muscles: ['Hamstrings'],
      musclesSecondary: null,
    })
    expect(set.updatedAt).toBeInstanceOf(Date)
  })

  it('returns null when the row is not owned (empty returning)', async () => {
    updateReturning = []

    expect(await updateCustomExercise(USER, 999, INPUT)).toBeNull()
  })
})
