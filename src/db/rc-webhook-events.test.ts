import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs over the Drizzle builders, in the house style of
 * entitlements.test.ts: selects resolve from a queue, inserts record their
 * values and script their conflict result, updates record their `set`.
 */
let selectQueue: Record<string, unknown>[][] = []
let insertConflicts = false
const inserts: Record<string, unknown>[] = []
const updates: Record<string, unknown>[] = []

function nextSelectRows() {
  return Promise.resolve(selectQueue.length > 0 ? selectQueue.shift()! : [])
}

vi.mock('./index', () => {
  const selectBuilder = () => {
    const b: Record<string, unknown> = {}
    b.from = () => b
    b.where = () => b
    b.orderBy = () => b
    b.groupBy = () => nextSelectRows()
    b.limit = () => nextSelectRows()
    return b
  }
  return {
    db: {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          inserts.push(v)
          return {
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve(insertConflicts ? [] : [{ id: v.id }]),
            }),
          }
        },
      }),
      select: () => selectBuilder(),
      update: () => ({
        set: (s: Record<string, unknown>) => ({
          where: () => {
            updates.push(s)
            return Promise.resolve()
          },
        }),
      }),
    },
  }
})

import {
  recordEvent,
  markProcessed,
  markFailed,
  countDeadLetters,
} from './rc-webhook-events'

const EVENT = {
  id: 'evt-synthetic-1',
  type: 'INITIAL_PURCHASE',
  appUserId: 'user_01SYNTHETIC',
  environment: 'PRODUCTION',
  payload: { event: { id: 'evt-synthetic-1' } },
}

beforeEach(() => {
  selectQueue = []
  insertConflicts = false
  inserts.length = 0
  updates.length = 0
})

describe('recordEvent', () => {
  it('returns "new" on first sight and stores the raw payload', () => {
    return recordEvent(EVENT).then((disposition) => {
      expect(disposition).toBe('new')
      expect(inserts[0]).toMatchObject({
        id: 'evt-synthetic-1',
        type: 'INITIAL_PURCHASE',
        appUserId: 'user_01SYNTHETIC',
        payload: EVENT.payload,
      })
    })
  })

  it('returns "already-done" for a redelivery of processed work, without bumping attempts', async () => {
    insertConflicts = true
    selectQueue = [[{ status: 'processed' }]]
    expect(await recordEvent(EVENT)).toBe('already-done')
    expect(updates).toHaveLength(0)
  })

  it('treats ignored and orphaned as done — retrying cannot change either', async () => {
    insertConflicts = true
    selectQueue = [[{ status: 'ignored' }]]
    expect(await recordEvent(EVENT)).toBe('already-done')
    selectQueue = [[{ status: 'orphaned' }]]
    expect(await recordEvent(EVENT)).toBe('already-done')
  })

  it('returns "retry" for a redelivery of unfinished work and bumps attempts', async () => {
    insertConflicts = true
    selectQueue = [[{ status: 'failed' }]]
    expect(await recordEvent(EVENT)).toBe('retry')
    expect(updates).toHaveLength(1)
  })

  it('a received row is also a retry — the first attempt may have died mid-flight', async () => {
    insertConflicts = true
    selectQueue = [[{ status: 'received' }]]
    expect(await recordEvent(EVENT)).toBe('retry')
  })

  it('conflict with a vanished row (purged between statements) is done, not an error', async () => {
    insertConflicts = true
    selectQueue = [[]]
    expect(await recordEvent(EVENT)).toBe('already-done')
  })
})

describe('status transitions', () => {
  it('markProcessed stamps the status and clears the error', async () => {
    await markProcessed('evt-synthetic-1')
    expect(updates[0]).toMatchObject({ status: 'processed', lastError: null })
    expect(updates[0].processedAt).toBeInstanceOf(Date)
  })

  it('markFailed records the error for the dead-letter view', async () => {
    await markFailed('evt-synthetic-1', 'rc api 503')
    expect(updates[0]).toMatchObject({ status: 'failed', lastError: 'rc api 503' })
  })
})

describe('countDeadLetters', () => {
  it('tallies failed and orphaned separately, defaulting missing groups to zero', async () => {
    selectQueue = [[{ status: 'failed', count: 3 }]]
    expect(await countDeadLetters()).toEqual({ failed: 3, orphaned: 0 })
  })
})
