import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stubs for the Drizzle builders, mirroring preferences.test.ts.
 *
 * Reads: `select().from().where()` / `selectDistinct().from()` resolve to
 * `selectRows`. Writes: inserts record values + conflict config; deletes
 * record their where() call count so ownership scoping is assertable at the
 * "a delete ran" level (the SQL itself is Drizzle's concern).
 */
let selectRows: Record<string, unknown>[] = []
const upserts: { values: unknown; conflict: unknown }[] = []
let deleteCount = 0

function makeSelectBuilder() {
  const builder = {
    from: () => builder,
    where: () => Promise.resolve(selectRows),
    then: (resolve: (rows: Record<string, unknown>[]) => unknown) =>
      Promise.resolve(selectRows).then(resolve),
  }
  return builder
}

function makeInsertBuilder() {
  let recordedValues: unknown
  return {
    values: (v: unknown) => {
      recordedValues = v
      return {
        onConflictDoUpdate: (c: unknown) => {
          upserts.push({ values: recordedValues, conflict: c })
          return Promise.resolve()
        },
      }
    },
  }
}

vi.mock('./index', () => ({
  db: {
    select: () => makeSelectBuilder(),
    selectDistinct: () => makeSelectBuilder(),
    insert: () => makeInsertBuilder(),
    delete: () => ({
      where: () => {
        deleteCount += 1
        return Promise.resolve()
      },
    }),
  },
}))

import {
  upsertPushSubscription,
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
  listPushSubscribedUserIds,
} from './push-subscriptions'

const USER = 'user_123'
const SUB = { endpoint: 'https://push.example.com/sub/1', p256dh: 'BKey', auth: 'Auth' }

beforeEach(() => {
  selectRows = []
  upserts.length = 0
  deleteCount = 0
})

describe('upsertPushSubscription', () => {
  it('inserts the endpoint + keys for the user with an endpoint-conflict update', async () => {
    // Act
    await upsertPushSubscription(USER, SUB)

    // Assert
    expect(upserts).toHaveLength(1)
    expect(upserts[0].values).toEqual({ userId: USER, ...SUB })
    const set = (upserts[0].conflict as { set: Record<string, unknown> }).set
    expect(set.userId).toBe(USER)
    expect(set.p256dh).toBe(SUB.p256dh)
    expect(set.auth).toBe(SUB.auth)
    expect(set.lastSeenAt).toBeInstanceOf(Date)
  })
})

describe('delete paths', () => {
  it('deletePushSubscription issues one scoped delete', async () => {
    await deletePushSubscription(USER, SUB.endpoint)
    expect(deleteCount).toBe(1)
  })

  it('deletePushSubscriptionByEndpoint issues one delete (prune path)', async () => {
    await deletePushSubscriptionByEndpoint(SUB.endpoint)
    expect(deleteCount).toBe(1)
  })
})

describe('reads', () => {
  it('listPushSubscriptions returns the selected rows', async () => {
    // Arrange
    selectRows = [{ id: 'id-1', ...SUB }]

    // Act + Assert
    expect(await listPushSubscriptions(USER)).toEqual([{ id: 'id-1', ...SUB }])
  })

  it('listPushSubscribedUserIds unwraps to plain ids', async () => {
    selectRows = [{ userId: 'user_a' }, { userId: 'user_b' }]
    expect(await listPushSubscribedUserIds()).toEqual(['user_a', 'user_b'])
  })
})
