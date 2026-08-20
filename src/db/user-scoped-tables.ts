import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import * as schema from './schema'

/**
 * Every table whose rows carry a `user_id`, enumerated FROM the schema rather
 * than listed by hand.
 *
 * The account-id migration has to rewrite all of them or it silently orphans
 * data, and a hand-maintained roster only covers what its author remembered —
 * the same review finding that put a schema-driven drift guard on the purge
 * roster (purge-user-data.test.ts). Deriving the list at runtime means a new
 * user-scoped table is covered the day it is added.
 *
 * Note this is a WIDER set than the purge roster on purpose: purge must leave
 * the consent ledger standing (pseudonymized — it is the retention evidence),
 * but an id migration must carry those rows across too, or the ledger stops
 * matching the account it documents.
 */
export function userScopedTableNames(): string[] {
  return Object.values(schema)
    .filter((value) => is(value, PgTable))
    // The schema's exports are narrowly-typed table objects (plus relations);
    // widening to the base PgTable is what lets them be walked uniformly.
    .map((value) => value as InstanceType<typeof PgTable>)
    .filter((table) => {
      const columns = getTableColumns(table) as Record<string, { name: string }>
      return Object.values(columns).some((column) => column.name === 'user_id')
    })
    .map((table) => getTableName(table))
    .sort()
}
