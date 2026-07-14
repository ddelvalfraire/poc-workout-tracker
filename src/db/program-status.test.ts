import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTableName, type Table, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * Chain-recording mock for `setProgramStatus` (mirrors patch-sets.test.ts):
 * every `db.update(table)` records its table + set-values and captures the
 * where-condition so scoping is assertable via PgDialect param introspection.
 * `ownedRows` toggles the ownership-gated activate's `.returning()` outcome;
 * the sibling-archive sweep has no `.returning()` and resolves via the
 * builder's thenable.
 */
const records: { op: string; values?: unknown }[] = []
const whereArgs: unknown[] = []
let ownedRows: { id: string }[] = [{ id: 'p1' }]

type Resolve = (value: unknown) => unknown

function updateChain(table: unknown) {
  const name = getTableName(table as Table)
  const obj = {
    set: (values: unknown) => {
      records.push({ op: `update:${name}`, values })
      return obj
    },
    where: (cond: unknown) => {
      whereArgs.push(cond)
      return obj
    },
    returning: () => ({
      then: (resolve: Resolve) => Promise.resolve(ownedRows).then(resolve),
    }),
    // The sibling sweep awaits .where() directly (no .returning()).
    then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
  }
  return obj
}

vi.mock('./index', () => ({
  db: { update: (table: unknown) => updateChain(table) },
}))

import { setProgramStatus } from './programs'

const USER = 'user_123'

function whereParams(index: number): unknown[] {
  return new PgDialect().sqlToQuery(whereArgs[index] as SQL).params
}

beforeEach(() => {
  records.length = 0
  whereArgs.length = 0
  ownedRows = [{ id: 'p1' }]
})

describe('setProgramStatus (single-active invariant)', () => {
  it('activating an owned program archives its sibling actives', async () => {
    // Act
    const result = await setProgramStatus(USER, 'p1', 'active')

    // Assert — gated activate first, then the sweep, both on programs
    expect(result).toEqual({ id: 'p1' })
    expect(records.map((r) => r.op)).toEqual(['update:programs', 'update:programs'])
    expect(records[1].values).toMatchObject({ status: 'archived' })
    // Sweep scoping: this user's ACTIVE programs, excluding the one just
    // activated — all three identifiers must appear in the condition.
    const sweep = whereParams(1)
    expect(sweep).toContain(USER)
    expect(sweep).toContain('p1')
    expect(sweep).toContain('active')
  })

  it('does NOT sweep when the activate fails the ownership gate', async () => {
    // Arrange — the gated update matches nothing (not owned / missing)
    ownedRows = []

    // Act
    const result = await setProgramStatus(USER, 'p1', 'active')

    // Assert — null result and no second update: an unowned id must never
    // archive anything
    expect(result).toBeNull()
    expect(records).toHaveLength(1)
  })

  it('archiving is a single update (no sweep)', async () => {
    const result = await setProgramStatus(USER, 'p1', 'archived')

    expect(result).toEqual({ id: 'p1' })
    expect(records).toHaveLength(1)
    expect(records[0].values).toMatchObject({ status: 'archived' })
  })

  it('setting draft is a single update (no sweep)', async () => {
    const result = await setProgramStatus(USER, 'p1', 'draft')

    expect(result).toEqual({ id: 'p1' })
    expect(records).toHaveLength(1)
  })

  it('scopes the gated update by user and program id', async () => {
    await setProgramStatus(USER, 'p1', 'archived')

    const gate = whereParams(0)
    expect(gate).toContain(USER)
    expect(gate).toContain('p1')
  })
})
