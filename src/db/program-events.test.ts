import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTableName, type Table, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * Chain-recording mock for the change-log module (mirrors program-status.test.ts):
 * `db.insert(table).values(v)` records the write; `db.select()...` captures the
 * where-condition (for PgDialect param introspection) and the limit, resolving
 * `rows` via the builder's thenable.
 */
const records: { op: string; values?: unknown }[] = []
const whereArgs: unknown[] = []
const limitArgs: number[] = []
let rows: unknown[] = []

type Resolve = (value: unknown) => unknown

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
    from: () => obj,
    where: (cond: unknown) => {
      whereArgs.push(cond)
      return obj
    },
    orderBy: () => obj,
    limit: (n: number) => {
      limitArgs.push(n)
      return obj
    },
    then: (resolve: Resolve) => Promise.resolve(rows).then(resolve),
  }
  return obj
}

vi.mock('./index', () => ({
  db: {
    insert: (table: unknown) => insertChain(table),
    select: () => selectChain(),
  },
}))

import { db } from './index'
import { recordProgramEvent, listProgramEvents } from './program-events'

const USER = 'user_123'
const PID = '22222222-2222-4222-8222-222222222222'

function whereParams(index: number): unknown[] {
  return new PgDialect().sqlToQuery(whereArgs[index] as SQL).params
}

beforeEach(() => {
  records.length = 0
  whereArgs.length = 0
  limitArgs.length = 0
  rows = []
})

describe('recordProgramEvent', () => {
  it('inserts one program_events row with every fact column', async () => {
    // Act
    await recordProgramEvent(db, {
      programId: PID,
      userId: USER,
      actor: 'coach',
      action: 'update_program_exercise',
      summary: 'Replace Incline DB Press → Larsen Press (Day 2)',
      payload: { before: { wgerExerciseId: 123 }, after: { wgerExerciseId: 456 } },
    })

    // Assert
    expect(records).toEqual([
      {
        op: 'insert:program_events',
        values: {
          programId: PID,
          userId: USER,
          actor: 'coach',
          action: 'update_program_exercise',
          summary: 'Replace Incline DB Press → Larsen Press (Day 2)',
          payload: { before: { wgerExerciseId: 123 }, after: { wgerExerciseId: 456 } },
        },
      },
    ])
  })

  it('stores an omitted payload as null (not undefined)', async () => {
    // Act
    await recordProgramEvent(db, {
      programId: PID,
      userId: USER,
      actor: 'ui',
      action: 'remove_program_day',
      summary: 'Remove Day 2',
    })

    // Assert
    expect(records[0]!.values).toMatchObject({ payload: null })
  })
})

describe('listProgramEvents', () => {
  it('scopes by user AND program — the ownership gate is the userId stamp', async () => {
    // Act
    await listProgramEvents(USER, PID)

    // Assert
    const params = whereParams(0)
    expect(params).toContain(USER)
    expect(params).toContain(PID)
  })

  it('defaults the limit to 25 and clamps it into 1..100', async () => {
    // Act
    await listProgramEvents(USER, PID)
    await listProgramEvents(USER, PID, { limit: 0 })
    await listProgramEvents(USER, PID, { limit: 500 })
    await listProgramEvents(USER, PID, { limit: 40 })

    // Assert
    expect(limitArgs).toEqual([25, 1, 100, 40])
  })

  it('adds the exclusive before-cursor to the condition when given', async () => {
    // Arrange
    const before = new Date('2026-07-18T10:00:00Z')

    // Act
    await listProgramEvents(USER, PID, { before })

    // Assert — the dialect serializes Date params to ISO strings
    expect(whereParams(0)).toContain('2026-07-18T10:00:00.000Z')
  })

  it('pages same-timestamp ties via the compound (before, beforeId) cursor', async () => {
    // Arrange — beforeId is the last row of the prior page; without the
    // compound form, unreturned rows TIED on this timestamp would be skipped.
    const before = new Date('2026-07-18T10:00:00Z')

    // Act
    await listProgramEvents(USER, PID, { before, beforeId: 'ev-last' })

    // Assert — both cursor components reach the predicate
    const params = whereParams(0)
    expect(params).toContain('2026-07-18T10:00:00.000Z')
    expect(params).toContain('ev-last')
  })

  it('resolves the rows the query returns', async () => {
    // Arrange
    rows = [{ id: 'ev1' }]

    // Act + Assert
    expect(await listProgramEvents(USER, PID)).toEqual([{ id: 'ev1' }])
  })
})
