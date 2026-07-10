import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs for the Drizzle builders inside `db.transaction`, mirroring
 * save-workout.test.ts / preferences.test.ts.
 *
 * Reads: `tx.select().from().where().orderBy().limit()` resolves to
 * `freshestRows` — the "freshest remaining log row" the resync derives from.
 * Inserts: `tx.insert().values(v)` records `v`; `.returning()` resolves to a
 * deterministic id row, `.onConflictDoUpdate(c)` records the upsert (the
 * user_preferences sync). Deletes: `.where().returning()` resolves to
 * `deleteResult`, controllable per-case to simulate ownership failures.
 */
let freshestRows: Record<string, unknown>[] = []
let deleteResult: { id: string }[] = []
const inserts: { values: unknown }[] = []
const upserts: { values: unknown; conflict: unknown }[] = []
let deleteCalls = 0

function makeTx() {
  const selectBuilder = {
    from: () => selectBuilder,
    where: () => selectBuilder,
    orderBy: () => selectBuilder,
    limit: () => Promise.resolve(freshestRows),
  }
  return {
    select: () => selectBuilder,
    insert: () => ({
      values: (v: unknown) => {
        inserts.push({ values: v })
        return {
          returning: () => Promise.resolve([{ id: 'bw1' }]),
          onConflictDoUpdate: (c: unknown) => {
            upserts.push({ values: v, conflict: c })
            return Promise.resolve()
          },
        }
      },
    }),
    delete: () => ({
      where: () => ({
        returning: () => {
          deleteCalls += 1
          return Promise.resolve(deleteResult)
        },
      }),
    }),
  }
}

vi.mock('./index', () => ({
  db: {
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
  },
}))

import { logBodyweight, deleteBodyweightLog } from './bodyweight'

const USER = 'user_123'

beforeEach(() => {
  freshestRows = []
  deleteResult = []
  inserts.length = 0
  upserts.length = 0
  deleteCalls = 0
})

describe('logBodyweight (transactional, user-scoped)', () => {
  it('inserts the log row and syncs prefs to the freshest row', async () => {
    // Arrange — after the insert, the freshest row IS the new entry
    freshestRows = [{ weightKg: 82.5 }]

    // Act
    const result = await logBodyweight(USER, 82.5)

    // Assert — log row insert (weighedAt omitted → column default now())
    expect(inserts[0].values).toEqual({ userId: USER, weightKg: 82.5 })
    // Assert — prefs synced to the freshest row's value, keyed by user
    expect(upserts).toHaveLength(1)
    expect(upserts[0].values).toMatchObject({ userId: USER, bodyweightKg: 82.5 })
    expect(upserts[0].conflict).toMatchObject({ set: { bodyweightKg: 82.5 } })
    expect(result).toEqual({ id: 'bw1' })
  })

  it('passes an explicit weighedAt through to the insert (backdated entry)', async () => {
    const weighedAt = new Date('2026-06-01T08:00:00Z')
    freshestRows = [{ weightKg: 84.0 }]

    await logBodyweight(USER, 81.0, weighedAt)

    expect(inserts[0].values).toEqual({ userId: USER, weightKg: 81.0, weighedAt })
  })

  it('syncs prefs from the FRESHEST row, not the just-written value — a backdated entry must not clobber current', async () => {
    // Arrange — a newer measurement (84.0) already exists; the write is older
    freshestRows = [{ weightKg: 84.0 }]

    // Act — backdated 81.0
    await logBodyweight(USER, 81.0, new Date('2026-06-01T08:00:00Z'))

    // Assert — prefs keep the newer 84.0, not the backdated 81.0
    expect(upserts[0].values).toMatchObject({ userId: USER, bodyweightKg: 84.0 })
    expect(upserts[0].conflict).toMatchObject({ set: { bodyweightKg: 84.0 } })
  })
})

describe('deleteBodyweightLog (transactional, user-scoped)', () => {
  it('deletes an owned row and resyncs prefs to the freshest remaining row', async () => {
    // Arrange
    deleteResult = [{ id: 'bw1' }]
    freshestRows = [{ weightKg: 83.2 }]

    // Act
    const result = await deleteBodyweightLog(USER, 'bw1')

    // Assert
    expect(result).toEqual({ id: 'bw1' })
    expect(upserts).toHaveLength(1)
    expect(upserts[0].values).toMatchObject({ userId: USER, bodyweightKg: 83.2 })
  })

  it('clears prefs to null when the last entry was deleted', async () => {
    // Arrange — delete succeeds, nothing remains
    deleteResult = [{ id: 'bw1' }]
    freshestRows = []

    // Act
    await deleteBodyweightLog(USER, 'bw1')

    // Assert — scoring degrades to the rep fallback, not a stale weight
    expect(upserts[0].values).toMatchObject({ userId: USER, bodyweightKg: null })
    expect(upserts[0].conflict).toMatchObject({ set: { bodyweightKg: null } })
  })

  it('returns null and does NOT touch prefs when the row is not owned (or gone)', async () => {
    // Arrange — the ownership-scoped delete matched nothing
    deleteResult = []

    // Act
    const result = await deleteBodyweightLog(USER, 'someone-elses-id')

    // Assert
    expect(result).toBe(null)
    expect(deleteCalls).toBe(1)
    expect(upserts).toHaveLength(0)
  })
})
