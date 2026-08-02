import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getHealthchecks } from './healthchecks'

// Pin the ops cache to passthrough: these tests assert vendor fetch
// behavior, not caching (cache.test.ts covers that).
vi.mock('@/lib/redis', () => ({ getRedis: () => null }))

function mockFetchSequence(
  responses: { ok: boolean; status?: number; body?: unknown }[],
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn()
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body,
    })
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const check = (name: string, status: string, uniqueKey = `uk-${name}`) => ({
  name,
  status,
  last_ping: '2026-08-01T09:00:00Z',
  next_ping: '2026-08-02T09:00:00Z',
  unique_key: uniqueKey,
})

const flip = (timestamp: string, up: 0 | 1) => ({ timestamp, up })

beforeEach(() => {
  vi.stubEnv('HEALTHCHECKS_API_KEY', 'hc-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getHealthchecks', () => {
  it("returns 'unconfigured' without an API key and never hits the network", async () => {
    vi.stubEnv('HEALTHCHECKS_API_KEY', '')
    const fetchMock = mockFetchSequence([])

    expect(await getHealthchecks()).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps checks with flips, counts non-up as down, and sends X-Api-Key', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, body: { checks: [check('cron', 'up'), check('backup', 'down')] } },
      { ok: true, body: { flips: [flip('2026-07-30T01:00:00Z', 1), flip('2026-07-29T23:00:00Z', 0)] } },
      { ok: true, body: { flips: [] } },
    ])

    const result = await getHealthchecks()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.checks).toHaveLength(2)
      expect(result.data.downCount).toBe(1)
      expect(result.data.checks[0]).toMatchObject({ name: 'cron', status: 'up' })
      expect(result.data.checks[0].flips).toEqual([
        { timestamp: '2026-07-30T01:00:00Z', up: true },
        { timestamp: '2026-07-29T23:00:00Z', up: false },
      ])
      expect(result.data.checks[1].flips).toEqual([])
    }
    const [listUrl, listInit] = fetchMock.mock.calls[0]
    expect(String(listUrl)).toBe('https://healthchecks.io/api/v3/checks/')
    expect(listInit.headers).toMatchObject({ 'X-Api-Key': 'hc-key' })
    // Flips are fetched per check via the read-only key's unique_key.
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://healthchecks.io/api/v3/checks/uk-cron/flips/',
    )
    expect(String(fetchMock.mock.calls[2][0])).toBe(
      'https://healthchecks.io/api/v3/checks/uk-backup/flips/',
    )
  })

  it('caps flips at the last five transitions', async () => {
    const manyFlips = Array.from({ length: 8 }, (_, i) =>
      flip(`2026-07-2${i}T00:00:00Z`, (i % 2) as 0 | 1),
    )
    mockFetchSequence([
      { ok: true, body: { checks: [check('cron', 'up')] } },
      { ok: true, body: { flips: manyFlips } },
    ])
    const result = await getHealthchecks()
    expect(result.ok && result.data.checks[0].flips).toHaveLength(5)
  })

  it('keeps the check with empty flips when its flips call fails', async () => {
    mockFetchSequence([
      { ok: true, body: { checks: [check('cron', 'up')] } },
      { ok: false, status: 500 },
    ])
    const result = await getHealthchecks()
    expect(result.ok).toBe(true)
    expect(result.ok && result.data.checks[0].flips).toEqual([])
  })

  it("treats 'new' checks as not-down", async () => {
    mockFetchSequence([
      { ok: true, body: { checks: [check('fresh', 'new')] } },
      { ok: true, body: { flips: [] } },
    ])
    const result = await getHealthchecks()
    expect(result.ok && result.data.downCount).toBe(0)
  })

  it("returns 'unavailable' on a non-200", async () => {
    mockFetchSequence([{ ok: false, status: 401 }])
    expect(await getHealthchecks()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it("returns 'unavailable' on a timeout / network error", async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('aborted')))
    expect(await getHealthchecks()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it("returns 'unavailable' when 'checks' is missing", async () => {
    mockFetchSequence([{ ok: true, body: { nope: true } }])
    expect(await getHealthchecks()).toEqual({ ok: false, reason: 'unavailable' })
  })
})
