import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTableName, type Table, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * Chain-recording mock for adoptProgram/declineProgram (mirrors
 * program-status.test.ts): every operation records its table + values and
 * captures where-conditions for PgDialect param introspection. `ownedRows`
 * toggles adopt's gated `.returning()`; `selectRows` feeds decline's
 * transactional ownership/proposed gate. `db.transaction(cb)` runs `cb` on a
 * tx handle sharing the same recorders, so decline's event-before-delete
 * ordering is assertable.
 */
const records: { op: string; values?: unknown }[] = []
const whereArgs: unknown[] = []
let ownedRows: { id: string }[] = [{ id: 'p1' }]
let selectRows: { id: string }[] = [{ id: 'p1' }]

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

function selectChain() {
  const obj = {
    from: (table: unknown) => {
      records.push({ op: `select:${getTableName(table as Table)}` })
      return obj
    },
    where: (cond: unknown) => {
      whereArgs.push(cond)
      return obj
    },
    then: (resolve: Resolve) => Promise.resolve(selectRows).then(resolve),
  }
  return obj
}

function deleteChain(table: unknown) {
  const name = getTableName(table as Table)
  return {
    where: (cond: unknown) => {
      records.push({ op: `delete:${name}` })
      whereArgs.push(cond)
      return { then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve) }
    },
  }
}

// Function declarations only (hoisted): the vi.mock factory runs before the
// test module body, so a top-level const here would hit the TDZ.
function makeHandle() {
  return {
    update: (table: unknown) => updateChain(table),
    insert: (table: unknown) => insertChain(table),
    select: () => selectChain(),
    delete: (table: unknown) => deleteChain(table),
  }
}

vi.mock('./index', () => ({
  db: {
    ...makeHandle(),
    transaction: (cb: (tx: ReturnType<typeof makeHandle>) => unknown) => cb(makeHandle()),
  },
}))

import { adoptProgram, declineProgram } from './programs'

const USER = 'user_123'

function whereParams(index: number): unknown[] {
  return new PgDialect().sqlToQuery(whereArgs[index] as SQL).params
}

beforeEach(() => {
  records.length = 0
  whereArgs.length = 0
  ownedRows = [{ id: 'p1' }]
  selectRows = [{ id: 'p1' }]
})

describe('adoptProgram (the forced confirm, accept path)', () => {
  it('adopt as draft: gated status flip + owner event, NO sweep', async () => {
    // Act
    const result = await adoptProgram(USER, 'p1', false)

    // Assert — one gated update, then the event; drafts never sweep
    expect(result).toEqual({ id: 'p1' })
    expect(records.map((r) => r.op)).toEqual(['update:programs', 'insert:program_events'])
    expect(records[0].values).toMatchObject({ status: 'draft' })
    expect(records[1].values).toMatchObject({
      programId: 'p1',
      userId: USER,
      actor: 'ui',
      action: 'adopt_program',
      summary: 'Proposal adopted → draft',
    })
    // The gate binds owner + id + the 'proposed' requirement — adopt can
    // never touch a non-proposal.
    const gate = whereParams(0)
    expect(gate).toContain(USER)
    expect(gate).toContain('p1')
    expect(gate).toContain('proposed')
  })

  it('adopt & activate: runs the single-active sweep, then the event', async () => {
    // Act
    const result = await adoptProgram(USER, 'p1', true)

    // Assert — gated activate, sibling sweep, owner event, in that order
    expect(result).toEqual({ id: 'p1' })
    expect(records.map((r) => r.op)).toEqual([
      'update:programs',
      'update:programs',
      'insert:program_events',
    ])
    expect(records[0].values).toMatchObject({ status: 'active' })
    expect(records[1].values).toMatchObject({ status: 'archived' })
    expect(records[2].values).toMatchObject({
      actor: 'ui',
      action: 'adopt_program',
      summary: 'Proposal adopted → active',
    })
    // Sweep scoping: this user's OTHER active programs only.
    const sweep = whereParams(1)
    expect(sweep).toContain(USER)
    expect(sweep).toContain('p1')
    expect(sweep).toContain('active')
  })

  it('returns null with no sweep/event when the row is not an owned proposal', async () => {
    // Arrange — already adopted, someone else's, or missing: gate matches nothing
    ownedRows = []

    // Act
    const result = await adoptProgram(USER, 'p1', true)

    // Assert — the no-op gate update is the only record
    expect(result).toBeNull()
    expect(records.map((r) => r.op)).toEqual(['update:programs'])
  })
})

describe('declineProgram (the forced confirm, reject path — hard delete v1)', () => {
  it('deletes the proposal and records the decline event first (FK order)', async () => {
    // Act
    const result = await declineProgram(USER, 'p1')

    // Assert — ownership/proposed gate read, event, THEN the delete: the
    // event insert must precede the delete or the FK rejects it.
    expect(result).toEqual({ id: 'p1' })
    expect(records.map((r) => r.op)).toEqual([
      'select:programs',
      'insert:program_events',
      'delete:programs',
    ])
    expect(records[1].values).toMatchObject({
      programId: 'p1',
      userId: USER,
      actor: 'ui',
      action: 'decline_program',
      summary: 'Proposal declined',
    })
    // The gate requires owner + id + 'proposed': decline can never delete an
    // adopted or owner-authored program.
    const gate = whereParams(0)
    expect(gate).toContain(USER)
    expect(gate).toContain('p1')
    expect(gate).toContain('proposed')
  })

  it('returns null and deletes nothing when the row is not an owned proposal', async () => {
    // Arrange
    selectRows = []

    // Act
    const result = await declineProgram(USER, 'p1')

    // Assert — the gate read only: no event, no delete
    expect(result).toBeNull()
    expect(records.map((r) => r.op)).toEqual(['select:programs'])
  })
})
