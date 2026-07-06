import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs for the Drizzle query builders, mirroring preferences.test.ts.
 *
 * Reads: `db.select().from().where().limit()` resolves to `selectRows`.
 * Writes: `db.insert().values(v).onConflictDoUpdate(c)` records `v` and `c`.
 * Deletes: `db.delete().where()` records the call.
 */
let selectRows: { payload: unknown; updatedAt: Date }[] = []
let selectKeyRows: { key: string }[] = []
const upserts: { values: unknown; conflict: unknown }[] = []
let deletes = 0

function makeSelectBuilder() {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => Promise.resolve(selectRows),
    // Terminal for putWorkoutDraft's prune query (no .limit()).
    orderBy: () => Promise.resolve(selectKeyRows),
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

import { getWorkoutDraft, putWorkoutDraft, deleteWorkoutDraft, listWorkoutDrafts } from './workout-drafts'

const USER = 'user_123'
const PAYLOAD = { v: 1, unit: 'kg', name: '', openedAt: '2026-07-05T11:40:00.000Z', draft: { exercises: [] } }

beforeEach(() => {
  selectRows = []
  selectKeyRows = []
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

  it('keeps rows within the per-user cap without pruning', async () => {
    // Arrange — two surfaces, well under the cap
    selectKeyRows = [{ key: 'new' }, { key: 'w1' }]

    // Act
    await putWorkoutDraft(USER, 'new', PAYLOAD)

    // Assert — no delete issued
    expect(deletes).toBe(0)
  })

  it('prunes the oldest drafts beyond the per-user cap', async () => {
    // Arrange — 21 rows, newest first (the prune query orders by updated_at desc)
    selectKeyRows = Array.from({ length: 21 }, (_, i) => ({ key: `key-${i}` }))

    // Act
    await putWorkoutDraft(USER, 'new', PAYLOAD)

    // Assert — one scoped delete for the overflow
    expect(deletes).toBe(1)
  })
})

describe('listWorkoutDrafts', () => {
  it('returns the user-scoped rows from the newest-first query', async () => {
    // Arrange — the orderBy-terminal select resolves these rows
    const rows = [{ key: 'new', payload: PAYLOAD, updatedAt: new Date('2026-07-05T12:00:00.000Z') }]
    selectKeyRows = rows as unknown as typeof selectKeyRows

    // Act + Assert
    expect(await listWorkoutDrafts(USER)).toEqual(rows)
  })
})

describe('deleteWorkoutDraft', () => {
  it('issues a scoped delete', async () => {
    await deleteWorkoutDraft(USER, 'w1')
    expect(deletes).toBe(1)
  })
})
