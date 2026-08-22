import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The consume mapping: a returned row = allowed, an empty result = cap
 * reached. (True atomicity under concurrency is a Postgres property, exercised
 * against the real DB, not unit-mockable — here we pin the allowed/denied and
 * limit-guard logic.)
 */
let returnRows: Array<{ used: number }> = []
const captured: { values?: unknown } = {}

vi.mock('./index', () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        captured.values = v
        return {
          onConflictDoUpdate: () => ({ returning: () => Promise.resolve(returnRows) }),
        }
      },
    }),
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(returnRows) }) }),
    }),
  },
}))

import { consumeUsage, getUsage } from './usage-counters'

beforeEach(() => {
  returnRows = []
  captured.values = undefined
})

describe('consumeUsage', () => {
  it('allows and reports used when a row comes back', async () => {
    returnRows = [{ used: 2 }]
    expect(await consumeUsage('user_1', 'coach_message', 'lifetime', 3)).toEqual({
      allowed: true,
      used: 2,
      limit: 3,
    })
    expect(captured.values).toMatchObject({
      userId: 'user_1',
      meter: 'coach_message',
      periodKey: 'lifetime',
      used: 1,
    })
  })

  it('denies when the update returns nothing (cap reached)', async () => {
    returnRows = []
    expect(await consumeUsage('user_1', 'coach_message', 'lifetime', 3)).toEqual({
      allowed: false,
      used: 3,
      limit: 3,
    })
  })

  it('refuses a non-positive limit without hitting the db', async () => {
    returnRows = [{ used: 1 }] // would "allow" if the query ran
    expect(await consumeUsage('user_1', 'coach_message', 'lifetime', 0)).toEqual({
      allowed: false,
      used: 0,
      limit: 0,
    })
    expect(captured.values).toBeUndefined()
  })
})

describe('getUsage', () => {
  it('returns 0 when there is no row', async () => {
    returnRows = []
    expect(await getUsage('user_1', 'coach_message', 'lifetime')).toBe(0)
  })

  it('returns the stored count', async () => {
    returnRows = [{ used: 2 }]
    expect(await getUsage('user_1', 'coach_message', 'lifetime')).toBe(2)
  })
})
