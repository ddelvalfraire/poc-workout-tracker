import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Orchestration test — every external is mocked, the assertions are about
 * SEQUENCE and EVIDENCE: the ledger event lands first (with both fan-out
 * rows), the purge precedes storage, pseudonymization spares the deletion
 * event, and Clerk dies last.
 */
const calls: string[] = []

const recordConsent = vi.fn(async () => {
  calls.push('recordConsent')
  return { eventId: 'ev-final' }
})
const markDownstreamAction = vi.fn(async (...args: unknown[]) => {
  calls.push(`mark:${String(args[1])}:${String(args[2])}`)
})
const pseudonymizeConsentRecords = vi.fn(async () => {
  calls.push('pseudonymize')
  return { pseudonym: 'deleted:abc', eventsPseudonymized: 3 }
})
vi.mock('@/db/consent', () => ({
  recordConsent: (...a: unknown[]) => recordConsent(...(a as [])),
  markDownstreamAction: (...a: unknown[]) => markDownstreamAction(...a),
  pseudonymizeConsentRecords: (...a: unknown[]) => pseudonymizeConsentRecords(...(a as [])),
}))

const purgeUserData = vi.fn(async () => {
  calls.push('purge')
  return { photoBlobKeys: ['user_1/p1/display.webp'] }
})
vi.mock('@/db/purge-user-data', () => ({
  purgeUserData: (...a: unknown[]) => purgeUserData(...(a as [])),
}))

const deleteObjects = vi.fn(async () => {
  calls.push('storage')
})
vi.mock('@/lib/supabase-storage', () => ({
  deleteObjects: (...a: unknown[]) => deleteObjects(...(a as [])),
}))

const redisDel = vi.fn(async () => 1)
const redisScan = vi.fn(async () => ['0', []] as [string, string[]])
let redisClient: { del: typeof redisDel; scan: typeof redisScan } | null = null
vi.mock('@/lib/redis', () => ({ getRedis: () => redisClient }))

const deletePosthogPerson = vi.fn(async () => {
  calls.push('posthog')
  return 'deleted' as const
})
vi.mock('@/lib/posthog-person-deletion', () => ({
  deletePosthogPerson: (...a: unknown[]) => deletePosthogPerson(...(a as [])),
}))

const clerkDeleteUser = vi.fn(async () => {
  calls.push('clerk')
})
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({ users: { deleteUser: clerkDeleteUser } }),
}))

import {
  deleteAccount,
  clearUserRedisKeys,
  checkAccountDeletionRateLimit,
  ACCOUNT_DELETION_DAILY_LIMIT,
  STORAGE_DELETE_BATCH_SIZE,
} from './account-deletion'

const PRESENTATION = {
  route: '/settings/delete-account',
  surface: 'settings' as const,
  controlLabel: 'Delete my account',
}

beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()
  redisClient = { del: redisDel, scan: redisScan }
  redisScan.mockResolvedValue(['0', []])
})

describe('deleteAccount', () => {
  it('runs the full sequence in order: evidence, purge, storage, posthog, pseudonymize, clerk', async () => {
    const result = await deleteAccount('user_1', PRESENTATION)

    expect(calls).toEqual([
      'recordConsent',
      'purge',
      'storage',
      'posthog',
      'mark:posthog:completed',
      'pseudonymize',
      'clerk',
      'mark:clerk:completed',
    ])
    expect(result).toEqual({
      pseudonym: 'deleted:abc',
      eventsPseudonymized: 3,
      posthog: 'deleted',
    })
  })

  it('enqueues the processor fan-out on ONE withdrawal event (the MHMDA evidence)', async () => {
    await deleteAccount('user_1', PRESENTATION)

    expect(recordConsent).toHaveBeenCalledTimes(1)
    expect((recordConsent.mock.calls as unknown as unknown[][])[0][0]).toMatchObject({
      userId: 'user_1',
      action: 'withdrawn',
      presentation: PRESENTATION,
      downstream: [
        { processor: 'posthog', action: 'person_delete' },
        { processor: 'clerk', action: 'user_delete' },
      ],
    })
  })

  it('passes the purged photo keys to storage deletion', async () => {
    await deleteAccount('user_1', PRESENTATION)
    expect(deleteObjects).toHaveBeenCalledWith(['user_1/p1/display.webp'])
  })

  it('chunks storage deletion so a photo-heavy account cannot outsize one request', async () => {
    const manyKeys = Array.from({ length: 250 }, (_, i) => `user_1/p${i}/key.webp`)
    purgeUserData.mockResolvedValueOnce({ photoBlobKeys: manyKeys })

    await deleteAccount('user_1', PRESENTATION)

    const batches = (deleteObjects.mock.calls as unknown as unknown[][]).map(
      (c) => c[0] as string[],
    )
    expect(batches.length).toBe(Math.ceil(manyKeys.length / STORAGE_DELETE_BATCH_SIZE))
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(STORAGE_DELETE_BATCH_SIZE)
    }
    // Nothing dropped, order preserved.
    expect(batches.flat()).toEqual(manyKeys)
  })

  it('spares the deletion event from the pseudonymize reconciliation', async () => {
    await deleteAccount('user_1', PRESENTATION)
    expect(pseudonymizeConsentRecords).toHaveBeenCalledWith('user_1', { keepEventId: 'ev-final' })
  })

  it('records a posthog failure on its evidence row and still finishes the deletion', async () => {
    deletePosthogPerson.mockRejectedValueOnce(new Error('api down'))

    const result = await deleteAccount('user_1', PRESENTATION)

    expect(result.posthog).toBe('failed')
    expect(markDownstreamAction).toHaveBeenCalledWith('ev-final', 'posthog', 'failed')
    // The rest of the sequence still ran — the account is gone.
    expect(clerkDeleteUser).toHaveBeenCalledWith('user_1')
    expect(pseudonymizeConsentRecords).toHaveBeenCalled()
  })

  it('lets a clerk failure throw (auth survives, the user retries)', async () => {
    clerkDeleteUser.mockRejectedValueOnce(new Error('clerk down'))

    await expect(deleteAccount('user_1', PRESENTATION)).rejects.toThrow('clerk down')
    // The clerk evidence row was never marked completed.
    expect(markDownstreamAction).not.toHaveBeenCalledWith('ev-final', 'clerk', 'completed')
  })

  it('propagates a storage failure BEFORE any external processor is told anything', async () => {
    deleteObjects.mockRejectedValueOnce(new Error('bucket down'))

    await expect(deleteAccount('user_1', PRESENTATION)).rejects.toThrow('bucket down')
    expect(deletePosthogPerson).not.toHaveBeenCalled()
    expect(clerkDeleteUser).not.toHaveBeenCalled()
  })
})

describe('checkAccountDeletionRateLimit', () => {
  const redisIncr = vi.fn(async () => 1)
  const redisExpire = vi.fn(async () => 1)

  beforeEach(() => {
    redisIncr.mockReset().mockResolvedValue(1)
    redisExpire.mockReset()
    redisClient = {
      del: redisDel,
      scan: redisScan,
      incr: redisIncr,
      expire: redisExpire,
    } as unknown as typeof redisClient
  })

  it('allows attempts under the daily cap and TTLs the counter on first use', async () => {
    redisIncr.mockResolvedValueOnce(1)
    await expect(checkAccountDeletionRateLimit('user_1')).resolves.toEqual({ allowed: true })

    const key = (redisIncr.mock.calls as unknown as unknown[][])[0]?.[0] as string
    expect(key).toMatch(/^account:delete:user_1:\d{4}-\d{2}-\d{2}$/)
    expect(redisExpire).toHaveBeenCalledWith(key, expect.any(Number))
  })

  it('blocks past the cap — a hostile retry loop cannot bloat consent_events', async () => {
    redisIncr.mockResolvedValueOnce(ACCOUNT_DELETION_DAILY_LIMIT + 1)
    await expect(checkAccountDeletionRateLimit('user_1')).resolves.toEqual({
      allowed: false,
      limit: ACCOUNT_DELETION_DAILY_LIMIT,
    })
  })

  it('fails open without redis or on redis errors — an outage must not trap a user in the app', async () => {
    redisClient = null
    await expect(checkAccountDeletionRateLimit('user_1')).resolves.toEqual({ allowed: true })

    redisClient = {
      del: redisDel,
      scan: redisScan,
      incr: redisIncr,
      expire: redisExpire,
    } as unknown as typeof redisClient
    redisIncr.mockRejectedValueOnce(new Error('redis down'))
    await expect(checkAccountDeletionRateLimit('user_1')).resolves.toEqual({ allowed: true })
  })

  it('is NOT swept by clearUserRedisKeys — deleting the counter mid-flow would defeat the cap', async () => {
    await clearUserRedisKeys('user_1')
    const allDeleted = redisDel.mock.calls.flat() as unknown as string[]
    expect(allDeleted.some((k) => String(k).startsWith('account:delete:'))).toBe(false)
  })
})

describe('clearUserRedisKeys', () => {
  it('deletes the chat draft and both rate-limit day counters', async () => {
    await clearUserRedisKeys('user_1')

    const keys = redisDel.mock.calls[0] as unknown as string[]
    expect(keys[0]).toBe('coach:chat:user_1')
    expect(keys[1]).toMatch(/^coach:msgs:user_1:\d{4}-\d{2}-\d{2}$/)
    expect(keys[2]).toMatch(/^coach:msgs:user_1:\d{4}-\d{2}-\d{2}$/)
    expect(keys[1]).not.toBe(keys[2])
  })

  it('scans out token-suffixed import previews', async () => {
    redisScan
      .mockResolvedValueOnce(['7', ['import:preview:user_1:tok-a']])
      .mockResolvedValueOnce(['0', ['import:preview:user_1:tok-b']])

    await clearUserRedisKeys('user_1')

    expect(redisScan).toHaveBeenCalledWith('0', {
      match: 'import:preview:user_1:*',
      count: 100,
    })
    expect(redisScan).toHaveBeenCalledTimes(2)
    expect(redisDel).toHaveBeenCalledWith('import:preview:user_1:tok-a')
    expect(redisDel).toHaveBeenCalledWith('import:preview:user_1:tok-b')
  })

  it('is a silent no-op without redis and swallows redis errors (TTL-bounded keys)', async () => {
    redisClient = null
    await expect(clearUserRedisKeys('user_1')).resolves.toBeUndefined()

    redisClient = { del: redisDel, scan: redisScan }
    redisDel.mockRejectedValueOnce(new Error('redis down'))
    await expect(clearUserRedisKeys('user_1')).resolves.toBeUndefined()
  })
})
