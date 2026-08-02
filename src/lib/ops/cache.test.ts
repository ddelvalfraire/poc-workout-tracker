import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cachedOpsFetch, OPS_STALE_TTL_SECONDS } from './cache'
import { getRedis } from '@/lib/redis'
import type { OpsResult } from './types'

vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }))

const mockedGetRedis = vi.mocked(getRedis)

interface Snapshot {
  n: number
}

const OK: OpsResult<Snapshot> = { ok: true, data: { n: 1 } }
const DOWN: OpsResult<Snapshot> = { ok: false, reason: 'unavailable' }

const entry = (data: Snapshot, fetchedAt: string) => JSON.stringify({ data, fetchedAt })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cachedOpsFetch', () => {
  it('passes straight through when Redis is not configured', async () => {
    mockedGetRedis.mockReturnValue(null)
    const fetcher = vi.fn().mockResolvedValue(OK)

    const result = await cachedOpsFetch('vendor', 120, fetcher)

    expect(result).toEqual(OK)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('serves a fresh hit without calling the fetcher', async () => {
    const get = vi.fn().mockResolvedValue(entry({ n: 7 }, '2026-08-01T09:00:00.000Z'))
    const set = vi.fn()
    mockedGetRedis.mockReturnValue({ get, set } as never)
    const fetcher = vi.fn()

    const result = await cachedOpsFetch<Snapshot>('vendor', 120, fetcher)

    expect(result).toEqual({ ok: true, data: { n: 7 } })
    expect(fetcher).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledWith('ops:vendor')
    expect(set).not.toHaveBeenCalled()
  })

  it('tolerates Upstash auto-deserialized objects on read', async () => {
    const get = vi
      .fn()
      .mockResolvedValue({ data: { n: 3 }, fetchedAt: '2026-08-01T09:00:00.000Z' })
    mockedGetRedis.mockReturnValue({ get, set: vi.fn() } as never)

    const result = await cachedOpsFetch<Snapshot>('vendor', 120, vi.fn())

    expect(result).toEqual({ ok: true, data: { n: 3 } })
  })

  it('populates both keys with their TTLs on a miss that fetches ok', async () => {
    const get = vi.fn().mockResolvedValue(null)
    const set = vi.fn().mockResolvedValue('OK')
    mockedGetRedis.mockReturnValue({ get, set } as never)
    const fetcher = vi.fn().mockResolvedValue(OK)

    const result = await cachedOpsFetch('vendor', 120, fetcher)

    expect(result).toEqual(OK)
    expect(set).toHaveBeenCalledTimes(2)
    const calls = set.mock.calls as [string, string, { ex: number }][]
    const fresh = calls.find(([key]) => key === 'ops:vendor')
    const stale = calls.find(([key]) => key === 'ops:stale:vendor')
    expect(fresh?.[2]).toEqual({ ex: 120 })
    expect(stale?.[2]).toEqual({ ex: OPS_STALE_TTL_SECONDS })
    // Both keys carry the same {data, fetchedAt} JSON payload.
    expect(JSON.parse(fresh?.[1] ?? '')).toMatchObject({ data: { n: 1 } })
    expect(fresh?.[1]).toBe(stale?.[1])
  })

  it('serves the stale copy with staleAt when the fetcher degrades', async () => {
    const get = vi
      .fn()
      // fresh miss, then the stale copy.
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(entry({ n: 5 }, '2026-08-01T06:00:00.000Z'))
    const set = vi.fn()
    mockedGetRedis.mockReturnValue({ get, set } as never)
    const fetcher = vi.fn().mockResolvedValue(DOWN)

    const result = await cachedOpsFetch<Snapshot>('vendor', 120, fetcher)

    expect(result).toEqual({ ok: true, data: { n: 5 }, staleAt: '2026-08-01T06:00:00.000Z' })
    expect(get).toHaveBeenNthCalledWith(2, 'ops:stale:vendor')
    expect(set).not.toHaveBeenCalled()
  })

  it('passes the degrade through when no stale copy exists', async () => {
    const get = vi.fn().mockResolvedValue(null)
    mockedGetRedis.mockReturnValue({ get, set: vi.fn() } as never)
    const fetcher = vi.fn().mockResolvedValue(DOWN)

    expect(await cachedOpsFetch('vendor', 120, fetcher)).toEqual(DOWN)
  })

  it('fails soft to the fetcher when Redis reads throw', async () => {
    const get = vi.fn().mockRejectedValue(new Error('redis down'))
    const set = vi.fn().mockRejectedValue(new Error('redis down'))
    mockedGetRedis.mockReturnValue({ get, set } as never)
    const fetcher = vi.fn().mockResolvedValue(OK)

    expect(await cachedOpsFetch('vendor', 120, fetcher)).toEqual(OK)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('ignores corrupt cache entries and fetches instead', async () => {
    const get = vi.fn().mockResolvedValue('not-json{')
    mockedGetRedis.mockReturnValue({ get, set: vi.fn() } as never)
    const fetcher = vi.fn().mockResolvedValue(OK)

    expect(await cachedOpsFetch('vendor', 120, fetcher)).toEqual(OK)
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
