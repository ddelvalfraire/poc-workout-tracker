import { describe, it, expect } from 'vitest'
import { userScopedTableNames } from './user-scoped-tables'

describe('userScopedTableNames', () => {
  it('finds every ownership root the purge roster deletes', () => {
    // Arrange — the purge roster is the independently reviewed list of
    // ownership roots. Anything it deletes is by definition user-scoped, so
    // it is the floor this enumeration must clear.
    const purged = [
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
    ]

    // Act
    const names = userScopedTableNames()

    // Assert
    expect(names).toEqual(expect.arrayContaining(purged))
  })

  it('also covers the consent ledger, which purge deliberately spares', () => {
    // The ledger survives account deletion (pseudonymized) but must still
    // follow the account across an id migration — otherwise the retention
    // evidence stops matching the user it documents.
    // Arrange / Act
    const names = userScopedTableNames()

    // Assert
    expect(names).toContain('consent_events')
    expect(names).toContain('consent_current')
  })

  it('lists only tables that really carry a user_id column', async () => {
    // Arrange — a false positive here would make the migration UPDATE a
    // column that does not exist, failing the whole transaction.
    const schema = await import('./schema')
    const { getTableColumns, getTableName, is } = await import('drizzle-orm')
    const { PgTable } = await import('drizzle-orm/pg-core')

    const byName = new Map(
      Object.values(schema)
        .filter((value) => is(value, PgTable))
        .map((table) => {
          const pgTable = table as InstanceType<typeof PgTable>
          return [getTableName(pgTable), pgTable] as const
        }),
    )

    // Act
    const names = userScopedTableNames()

    // Assert
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const table = byName.get(name)
      expect(table, `${name} is not a table in the schema`).toBeDefined()
      const columns = getTableColumns(table!) as Record<string, { name: string }>
      expect(
        Object.values(columns).some((column) => column.name === 'user_id'),
        `${name} has no user_id column`,
      ).toBe(true)
    }
  })

  it('excludes child tables that reach the user through their parent', () => {
    // workout_exercises/sets hang off workouts by a cascading FK and carry no
    // user_id of their own — rewriting the root is what moves them.
    // Arrange / Act
    const names = userScopedTableNames()

    // Assert
    expect(names).not.toContain('workout_exercises')
    expect(names).not.toContain('sets')
  })
})
