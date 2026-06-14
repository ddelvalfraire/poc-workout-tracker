import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs for the Drizzle query builders, mirroring save-workout.test.ts.
 *
 * Reads: `db.select().from().where().limit()` resolves to `selectRows`, a
 * controllable array the test sets per-case.
 * Writes: `db.insert().values(v).onConflictDoUpdate(c)` records `v` and `c` so
 * the test can assert WHAT was upserted without a real database.
 */
let selectRows: { unit: string }[] = []
const upserts: { values: unknown; conflict: unknown }[] = []

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
  },
}))

import { getWeightUnit, setWeightUnit } from './preferences'

const USER = 'user_123'

beforeEach(() => {
  selectRows = []
  upserts.length = 0
})

describe('getWeightUnit', () => {
  it('defaults to lb when no row exists', async () => {
    selectRows = []
    expect(await getWeightUnit(USER)).toBe('lb')
  })

  it('returns the stored unit when valid', async () => {
    selectRows = [{ unit: 'kg' }]
    expect(await getWeightUnit(USER)).toBe('kg')
  })

  it('falls back to the default (lb) when the stored value is corrupt', async () => {
    selectRows = [{ unit: 'garbage' }]
    expect(await getWeightUnit(USER)).toBe('lb')
  })
})

describe('setWeightUnit', () => {
  it('upserts the chosen unit by user id', async () => {
    await setWeightUnit(USER, 'lb')

    expect(upserts).toHaveLength(1)
    expect(upserts[0].values).toMatchObject({ userId: USER, unit: 'lb' })
    expect(upserts[0].conflict).toMatchObject({ set: { unit: 'lb' } })
  })
})
