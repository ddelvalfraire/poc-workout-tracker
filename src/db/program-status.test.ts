import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTableName, type Table, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * Chain-recording mock for `setProgramStatus` (mirrors patch-sets.test.ts):
 * every `db.update(table)` records its table + set-values and captures the
 * where-condition so scoping is assertable via PgDialect param introspection.
 * `ownedRows` toggles the ownership-gated activate's `.returning()` outcome;
 * the sibling-archive sweep has no `.returning()` and resolves via the
 * builder's thenable. `db.insert` records the change-log event write
 * (`insert:program_events`) — the one mutator that logs on the root handle.
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

function insertChain(table: unknown) {
  const name = getTableName(table as Table)
  return {
    values: (values: unknown) => {
      records.push({ op: `insert:${name}`, values })
      return { then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve) }
    },
  }
}

vi.mock('./index', () => ({
  db: {
    update: (table: unknown) => updateChain(table),
    insert: (table: unknown) => insertChain(table),
  },
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
    const result = await setProgramStatus(USER, 'p1', 'active', 'ui')

    // Assert — gated activate first, then the sweep, then the change-log event
    expect(result).toEqual({ id: 'p1' })
    expect(records.map((r) => r.op)).toEqual([
      'update:programs',
      'update:programs',
      'insert:program_events',
    ])
    expect(records[1].values).toMatchObject({ status: 'archived' })
    expect(records[2].values).toMatchObject({
      programId: 'p1',
      userId: USER,
      actor: 'ui',
      action: 'set_program_status',
      summary: 'Status → active',
    })
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
    const result = await setProgramStatus(USER, 'p1', 'active', 'ui')

    // Assert — null result and no second update: an unowned id must never
    // archive anything
    expect(result).toBeNull()
    expect(records).toHaveLength(1)
  })

  it('archiving is a single update (no sweep) plus its event', async () => {
    const result = await setProgramStatus(USER, 'p1', 'archived', 'ui')

    expect(result).toEqual({ id: 'p1' })
    expect(records.map((r) => r.op)).toEqual(['update:programs', 'insert:program_events'])
    expect(records[0].values).toMatchObject({ status: 'archived' })
  })

  it('setting draft is a single update (no sweep) plus its event', async () => {
    const result = await setProgramStatus(USER, 'p1', 'draft', 'ui')

    expect(result).toEqual({ id: 'p1' })
    expect(records.map((r) => r.op)).toEqual(['update:programs', 'insert:program_events'])
  })

  it('scopes the gated update by user and program id', async () => {
    await setProgramStatus(USER, 'p1', 'archived', 'ui')

    const gate = whereParams(0)
    expect(gate).toContain(USER)
    expect(gate).toContain('p1')
  })
})
