import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs for the Drizzle query builders, mirroring preferences.test.ts.
 *
 * Reads: `db.select().from().where().limit()` resolves to `selectRows`.
 * Writes: `db.insert().values(v).onConflictDoUpdate(c)` records `v` and `c`.
 * Deletes: `db.delete().where()` records the call.
 */
let selectRows: { payload: unknown; updatedAt: Date }[] = []
const upserts: { values: unknown; conflict: unknown }[] = []
let deletes = 0

function makeSelectBuilder() {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => Promise.resolve(selectRows),
  }
  return builder
}

function makeInsertBuilder() {
  let recordedValues: unknown
  return {
    values: (v: unknown) => {
      recordedValues = v
      return {
        onConflictDoUpdate: (c: unknown) => {
          upserts.push({ values: recordedValues, conflict: c })
          return Promise.resolve()
        },
      }
    },
  }
}

vi.mock('./index', () => ({
  db: {
    select: () => makeSelectBuilder(),
    insert: () => makeInsertBuilder(),
    delete: () => ({
      where: () => {
        deletes += 1
        return Promise.resolve()
      },
    }),
  },
}))

import { getWorkoutDraft, putWorkoutDraft, deleteWorkoutDraft } from './workout-drafts'

const USER = 'user_123'
const PAYLOAD = { v: 1, unit: 'kg', name: '', openedAt: '2026-07-05T11:40:00.000Z', draft: { exercises: [] } }

beforeEach(() => {
  selectRows = []
  upserts.length = 0
  deletes = 0
})

describe('getWorkoutDraft', () => {
  it('returns undefined when no row exists', async () => {
    expect(await getWorkoutDraft(USER, 'new')).toBeUndefined()
  })

  it('returns the stored payload and updatedAt', async () => {
    const updatedAt = new Date('2026-07-05T12:00:00.000Z')
    selectRows = [{ payload: PAYLOAD, updatedAt }]

    expect(await getWorkoutDraft(USER, 'new')).toEqual({ payload: PAYLOAD, updatedAt })
  })
})

describe('putWorkoutDraft', () => {
  it('upserts by (userId, key), refreshing updatedAt (last writer wins)', async () => {
    await putWorkoutDraft(USER, 'new', PAYLOAD)

    expect(upserts).toHaveLength(1)
    expect(upserts[0].values).toMatchObject({ userId: USER, key: 'new', payload: PAYLOAD })
    expect(upserts[0].conflict).toMatchObject({ set: { payload: PAYLOAD, updatedAt: expect.any(Date) } })
  })
})

describe('deleteWorkoutDraft', () => {
  it('issues a scoped delete', async () => {
    await deleteWorkoutDraft(USER, 'w1')
    expect(deletes).toBe(1)
  })
})
