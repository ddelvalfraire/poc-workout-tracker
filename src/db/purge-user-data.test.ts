import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTableName } from 'drizzle-orm'

/**
 * Recording stub per the consent.test.ts idiom: the select resolves the
 * scripted photo rows, each delete records the table it targeted (by drizzle
 * table name), everything inside one transaction callback.
 */
let photoRows: Record<string, unknown>[] = []
const deletedTables: string[] = []
const ops: string[] = []

function makeDb() {
  const database = {
    select: () => ({
      from: () => ({
        where: () => {
          ops.push('select')
          return Promise.resolve(photoRows)
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        ops.push('delete')
        deletedTables.push(getTableName(table as Parameters<typeof getTableName>[0]))
        return Promise.resolve()
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(database),
  }
  return database
}

vi.mock('./index', () => ({ db: makeDb() }))

import { purgeUserData } from './purge-user-data'

beforeEach(() => {
  photoRows = []
  deletedTables.length = 0
  ops.length = 0
})

describe('purgeUserData', () => {
  it('collects photo blob keys BEFORE any row is deleted', async () => {
    photoRows = [
      { blobKeyDisplay: 'user_1/p1/display.webp', blobKeyThumb: 'user_1/p1/thumb.webp' },
      { blobKeyDisplay: 'user_1/p2/display.webp', blobKeyThumb: 'user_1/p2/thumb.webp' },
    ]

    const result = await purgeUserData('user_1')

    expect(ops[0]).toBe('select')
    expect(result.photoBlobKeys).toEqual([
      'user_1/p1/display.webp',
      'user_1/p1/thumb.webp',
      'user_1/p2/display.webp',
      'user_1/p2/thumb.webp',
    ])
  })

  it('sweeps every user-scoped ownership root (consent tables excluded by design)', async () => {
    await purgeUserData('user_1')

    // The complete roster of tables whose rows carry the WorkOS user id.
    // Child tables ride the onDelete:'cascade' FKs; consent tables must
    // survive (pseudonymized) so their absence here is the contract.
    expect([...deletedTables].sort()).toEqual(
      [
        'program_patch_proposals',
        'program_events',
        'workouts',
        'import_batches',
        'programs',
        'workout_templates',
        'workout_drafts',
        'custom_exercises',
        'exercise_notes',
        'notes',
        'bodyweight_logs',
        'body_measurements',
        'progress_photos',
        'goals',
        'trophies',
        'push_subscriptions',
        'user_preferences',
        'entitlements_current',
        'entitlement_grants',
        'rc_webhook_events',
      ].sort(),
    )
    expect(deletedTables).not.toContain('consent_events')
    expect(deletedTables).not.toContain('consent_current')
    expect(deletedTables).not.toContain('consent_downstream_actions')
  })

  it('every user_id-bearing table in the schema is purged or explicitly accounted for', async () => {
    // Schema-driven drift guard (review finding: a hand-maintained roster
    // only re-validates what the author remembered — this fails CI the day
    // someone adds a user-scoped table and forgets deletion). Enumerate the
    // real schema; every table with a user id column must appear in the
    // purge roster or in the reasoned allow-list below.
    const schema = await import('./schema')
    const { getTableColumns, getTableName, is } = await import('drizzle-orm')
    const { PgTable } = await import('drizzle-orm/pg-core')

    const ACCOUNTED: Record<string, string> = {
      consent_events: 'retained pseudonymized (CA ARL evidence) via pseudonymizeConsentRecords',
      consent_current: 'deleted inside pseudonymizeConsentRecords, same transaction',
    }
    await purgeUserData('user_1')

    const userScopedTables = Object.values(schema)
      .filter((v) => is(v, PgTable))
      .map((t) => t as InstanceType<typeof PgTable>)
      .filter((t) => {
        const columns = getTableColumns(t) as Record<string, { name: string }>
        // app_user_id: the RC webhook inbox carries our user id under the
        // vendor's column name — the drift guard must see it too.
        return Object.values(columns).some((c) => c.name === 'user_id' || c.name === 'app_user_id')
      })
      .map((t) => getTableName(t))

    expect(userScopedTables.length).toBeGreaterThan(15)
    for (const table of userScopedTables) {
      const covered = [...deletedTables].includes(table) || table in ACCOUNTED
      expect(covered, `user-scoped table "${table}" is neither purged nor allow-listed`).toBe(true)
    }
  })

  it('returns empty keys for a user with no photos', async () => {
    const result = await purgeUserData('user_2')
    expect(result.photoBlobKeys).toEqual([])
  })
})
