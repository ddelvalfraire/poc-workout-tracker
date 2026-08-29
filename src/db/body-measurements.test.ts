import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MeasurementSite } from '@/lib/body/measurement-sites'

/**
 * Recording stubs for the Drizzle builders, mirroring bodyweight.test.ts —
 * minus the transaction wrapper: measurements have no denormalized current
 * value to resync, so the module issues single statements straight off `db`.
 *
 * Inserts: `db.insert().values(v)` records `v`; `.returning()` resolves to a
 * deterministic id row. Deletes: `.where().returning()` resolves to
 * `deleteResult`, controllable per-case to simulate ownership failures.
 */
const inserts: { values: unknown }[] = []
let deleteResult: { id: string }[] = []
let deleteCalls = 0

vi.mock('./index', () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        inserts.push({ values: v })
        return { returning: () => Promise.resolve([{ id: 'bm1' }]) }
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
  },
}))

import { logMeasurement, deleteMeasurement } from './body-measurements'

const USER = 'user_123'

beforeEach(() => {
  inserts.length = 0
  deleteResult = []
  deleteCalls = 0
})

describe('logMeasurement (user-scoped)', () => {
  it('inserts a whitelisted site with an in-range value', async () => {
    // Act
    const result = await logMeasurement(USER, 'waist', 84.5)

    // Assert — measuredAt omitted → column default now()
    expect(inserts[0].values).toEqual({ userId: USER, site: 'waist', valueCm: 84.5 })
    expect(result).toEqual({ id: 'bm1' })
  })

  it('passes an explicit measuredAt through to the insert (backdated entry)', async () => {
    const measuredAt = new Date('2026-06-01T08:00:00Z')

    await logMeasurement(USER, 'chest', 101.25, measuredAt)

    expect(inserts[0].values).toEqual({
      userId: USER,
      site: 'chest',
      valueCm: 101.25,
      measuredAt,
    })
  })

  it('rejects a site outside the whitelist without inserting', async () => {
    await expect(
      logMeasurement(USER, 'forearm' as MeasurementSite, 30),
    ).rejects.toThrow('invalid measurement site')
    expect(inserts).toHaveLength(0)
  })

  it.each([
    ['under the 10 cm floor (a slipped decimal)', 8.4],
    ['over the 300 cm ceiling (a typo’d extra digit)', 845],
    ['a non-finite value', NaN],
  ])('rejects %s without inserting', async (_label, valueCm) => {
    await expect(logMeasurement(USER, 'waist', valueCm)).rejects.toThrow(
      'between 10 and 300 cm',
    )
    expect(inserts).toHaveLength(0)
  })

  it('accepts the 10 and 300 boundary values', async () => {
    await logMeasurement(USER, 'neck', 10)
    await logMeasurement(USER, 'hips', 300)

    expect(inserts[0].values).toMatchObject({ site: 'neck', valueCm: 10 })
    expect(inserts[1].values).toMatchObject({ site: 'hips', valueCm: 300 })
  })
})

describe('deleteMeasurement (user-scoped)', () => {
  it('deletes an owned row and returns its id', async () => {
    // Arrange
    deleteResult = [{ id: 'bm1' }]

    // Act
    const result = await deleteMeasurement(USER, 'bm1')

    // Assert
    expect(result).toEqual({ id: 'bm1' })
    expect(deleteCalls).toBe(1)
  })

  it('returns null when the row is not owned (or gone)', async () => {
    // Arrange — the ownership-scoped delete matched nothing
    deleteResult = []

    // Act
    const result = await deleteMeasurement(USER, 'someone-elses-id')

    // Assert
    expect(result).toBe(null)
    expect(deleteCalls).toBe(1)
  })
})
