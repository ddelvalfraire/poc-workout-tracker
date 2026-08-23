import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTableName, type Table, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * Chain-recording mock for the session change-log module, lifted from
 * program-events.test.ts: `db.insert(table).values(v)` records the write;
 * `db.select()...` captures the where-condition (for PgDialect param
 * introspection) and the limit, resolving `rows` via the builder's thenable.
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
import {
  AMENDMENT_KINDS,
  listWorkoutEvents,
  recordWorkoutEvent,
  recordWorkoutEvents,
} from './workout-events'

const USER = 'user_123'
const WID = '11111111-1111-4111-8111-111111111111'

const SNAPSHOT = {
  source: 'wger',
  wgerExerciseId: 73,
  exerciseName: 'Squat',
  setNumber: 3,
  reps: 5,
  weight: 100,
  completed: true,
  rir: null,
  rpe: null,
  metricMode: 'reps_weight',
  durationSec: null,
  distanceM: null,
}

function whereParams(index: number): unknown[] {
  return new PgDialect().sqlToQuery(whereArgs[index] as SQL).params
}

beforeEach(() => {
  records.length = 0
  whereArgs.length = 0
  limitArgs.length = 0
  rows = []
})

describe('recordWorkoutEvent', () => {
  it('inserts one workout_events row with every fact column', async () => {
    // Act
    await recordWorkoutEvent(db, {
      workoutId: WID,
      userId: USER,
      kind: 'amendment',
      actor: 'coach',
      action: 'update_set',
      summary: 'Set 3 of Squat — weight 100 → 102.5',
      changed: ['weight'],
      before: SNAPSHOT,
      after: { ...SNAPSHOT, weight: 102.5 },
    })

    // Assert
    expect(records).toEqual([
      {
        op: 'insert:workout_events',
        values: {
          workoutId: WID,
          userId: USER,
          kind: 'amendment',
          actor: 'coach',
          action: 'update_set',
          summary: 'Set 3 of Squat — weight 100 → 102.5',
          changed: ['weight'],
          before: SNAPSHOT,
          after: { ...SNAPSHOT, weight: 102.5 },
        },
      },
    ])
  })

  it('stores an omitted before/after as null and an omitted changed as an empty array', async () => {
    // A creation has no before-image and nothing in `changed`; the columns are
    // nullable / NOT NULL respectively, so both defaults must be explicit.
    // Act
    await recordWorkoutEvent(db, {
      workoutId: WID,
      userId: USER,
      kind: 'original',
      actor: 'ui',
      action: 'create_workout',
      summary: 'Logged Leg Day — 3 exercises, 9 sets',
      after: { name: 'Leg Day', exerciseCount: 3, setCount: 9 },
    })

    // Assert
    expect(records[0]!.values).toMatchObject({ before: null, changed: [] })
  })

  it('copies `changed` rather than aliasing the caller’s array', async () => {
    // Arrange — the caller's array is its own working state.
    const changed = ['weight']

    // Act
    await recordWorkoutEvent(db, {
      workoutId: WID,
      userId: USER,
      kind: 'amendment',
      actor: 'ui',
      action: 'update_set',
      summary: 'Set 3 of Squat — weight 100 → 102.5',
      changed,
    })
    changed.push('reps')

    // Assert
    expect((records[0]!.values as { changed: string[] }).changed).toEqual(['weight'])
  })
})

describe('recordWorkoutEvents', () => {
  it('writes every intent in ONE insert', async () => {
    // Act
    await recordWorkoutEvents(db, [
      {
        workoutId: WID,
        userId: USER,
        kind: 'amendment',
        actor: 'ui',
        action: 'update_set',
        summary: 'Set 3 of Squat — reps 5 → 6',
        changed: ['reps'],
      },
      {
        workoutId: WID,
        userId: USER,
        kind: 'amendment',
        actor: 'ui',
        action: 'remove_set',
        summary: 'Set 4 of Squat removed',
        before: SNAPSHOT,
      },
    ])

    // Assert
    expect(records).toHaveLength(1)
    expect(records[0]!.values).toHaveLength(2)
  })

  it('writes NOTHING for an empty batch (an edit that changed nothing has no history)', async () => {
    // Act
    await recordWorkoutEvents(db, [])

    // Assert
    expect(records).toEqual([])
  })
})

describe('listWorkoutEvents', () => {
  it('scopes by user AND workout — the ownership gate is the userId stamp', async () => {
    // Act
    await listWorkoutEvents(USER, WID)

    // Assert
    const params = whereParams(0)
    expect(params).toContain(USER)
    expect(params).toContain(WID)
  })

  it('returns the FULL stream by default — no kind filter reaches the predicate', async () => {
    // Act
    await listWorkoutEvents(USER, WID)

    // Assert
    expect(whereParams(0)).toEqual([USER, WID])
  })

  it('narrows to amendments only when asked', async () => {
    // Act
    await listWorkoutEvents(USER, WID, { kinds: AMENDMENT_KINDS })

    // Assert
    expect(whereParams(0)).toContain('amendment')
  })

  it('accepts an arbitrary kind set (amendments plus late entries)', async () => {
    // Act
    await listWorkoutEvents(USER, WID, { kinds: ['amendment', 'late_entry'] })

    // Assert
    const params = whereParams(0)
    expect(params).toContain('amendment')
    expect(params).toContain('late_entry')
  })

  it('treats an EMPTY kinds array as no filter, never as "match nothing"', async () => {
    // A false predicate would silently hide the whole log.
    // Act
    await listWorkoutEvents(USER, WID, { kinds: [] })

    // Assert — only the user + workout equalities carry params
    expect(whereParams(0)).toEqual([USER, WID])
  })

  it('defaults the limit to 25 and clamps it into 1..100', async () => {
    // Act
    await listWorkoutEvents(USER, WID)
    await listWorkoutEvents(USER, WID, { limit: 0 })
    await listWorkoutEvents(USER, WID, { limit: 500 })
    await listWorkoutEvents(USER, WID, { limit: 40 })

    // Assert
    expect(limitArgs).toEqual([25, 1, 100, 40])
  })

  it('adds the exclusive before-cursor to the condition when given', async () => {
    // Arrange
    const before = new Date('2026-07-18T10:00:00Z')

    // Act
    await listWorkoutEvents(USER, WID, { before })

    // Assert — the dialect serializes Date params to ISO strings
    expect(whereParams(0)).toContain('2026-07-18T10:00:00.000Z')
  })

  it('pages same-timestamp ties via the compound (before, beforeId) cursor', async () => {
    // Arrange — without the compound form, unreturned rows TIED on this
    // timestamp would be skipped entirely.
    const before = new Date('2026-07-18T10:00:00Z')

    // Act
    await listWorkoutEvents(USER, WID, { before, beforeId: 'ev-last' })

    // Assert
    const params = whereParams(0)
    expect(params).toContain('2026-07-18T10:00:00.000Z')
    expect(params).toContain('ev-last')
  })

  it('resolves the rows the query returns', async () => {
    // Arrange
    rows = [{ id: 'ev1' }]

    // Act + Assert
    expect(await listWorkoutEvents(USER, WID)).toEqual([{ id: 'ev1' }])
  })
})
