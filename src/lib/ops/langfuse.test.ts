import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getLangfuseDaily, getLangfuseTraces } from './langfuse'

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

const day = (date: string, traces: number, cost: number, tokens: number) => ({
  date,
  countTraces: traces,
  countObservations: traces * 2,
  totalCost: cost,
  usage: [{ model: 'claude', totalUsage: tokens }],
})

const observation = (startTime: string, extra: Record<string, unknown> = {}) => ({
  id: `obs-${startTime}`,
  type: 'GENERATION',
  startTime,
  name: 'coach-chat',
  latency: 1.234,
  totalCost: 0.0042,
  usageDetails: { input: 900, output: 100, total: 1000 },
  providedModelName: 'anthropic/claude-sonnet',
  ...extra,
})

beforeEach(() => {
  vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-1')
  vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-1')
  vi.stubEnv('LANGFUSE_BASEURL', 'https://us.cloud.langfuse.com')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getLangfuseDaily', () => {
  it("returns 'unconfigured' when a key is missing and never hits the network", async () => {
    vi.stubEnv('LANGFUSE_SECRET_KEY', '')
    const fetchMock = mockFetchSequence([])

    expect(await getLangfuseDaily()).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sums traces/cost/tokens over 14 days and sends Basic auth to the metrics endpoint', async () => {
    const fetchMock = mockFetchSequence([
      {
        ok: true,
        body: {
          data: [day('2026-08-01', 10, 1.5, 2000), day('2026-07-31', 4, 0.5, 800)],
          meta: { page: 1 },
        },
      },
    ])

    const result = await getLangfuseDaily()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.days).toHaveLength(2)
      expect(result.data.totalTraces).toBe(14)
      expect(result.data.totalCost).toBeCloseTo(2.0)
      expect(result.data.days[0].tokens).toBe(2000)
    }
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://us.cloud.langfuse.com/api/public/metrics/daily?limit=14')
    const expectedAuth = `Basic ${Buffer.from('pk-1:sk-1').toString('base64')}`
    expect(init.headers).toMatchObject({ Authorization: expectedAuth })
  })

  it('computes the 7d pill cost from the newest seven days only', async () => {
    // Newest-first, eight days: the eighth day's cost must NOT count.
    const days = Array.from({ length: 8 }, (_, i) =>
      day(`2026-07-${25 + i}`, 1, i < 7 ? 1 : 100, 10),
    )
    mockFetchSequence([{ ok: true, body: { data: days } }])

    const result = await getLangfuseDaily()

    expect(result.ok && result.data.totalCost7d).toBeCloseTo(7)
    expect(result.ok && result.data.totalCost).toBeCloseTo(107)
  })

  it('defaults the base URL when LANGFUSE_BASEURL is unset', async () => {
    vi.stubEnv('LANGFUSE_BASEURL', '')
    const fetchMock = mockFetchSequence([{ ok: true, body: { data: [] } }])
    await getLangfuseDaily()
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://cloud.langfuse.com/')
  })

  it("returns 'unavailable' on a non-200", async () => {
    mockFetchSequence([{ ok: false, status: 500 }])
    expect(await getLangfuseDaily()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it("returns 'unavailable' on a timeout / network error", async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('aborted')))
    expect(await getLangfuseDaily()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it("returns 'unavailable' when 'data' isn't an array", async () => {
    mockFetchSequence([{ ok: true, body: { data: null } }])
    expect(await getLangfuseDaily()).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('getLangfuseTraces', () => {
  it("returns 'unconfigured' when a key is missing and never hits the network", async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', '')
    const fetchMock = mockFetchSequence([])

    expect(await getLangfuseTraces()).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queries the v2 observations endpoint for generations and maps table rows', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, body: { data: [observation('2026-08-01T10:00:00Z')], meta: {} } },
    ])

    const result = await getLangfuseTraces()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.traces).toHaveLength(1)
      expect(result.data.traces[0]).toEqual({
        time: '2026-08-01T10:00:00Z',
        name: 'coach-chat',
        latencyMs: 1234,
        totalCost: 0.0042,
        tokens: 1000,
        model: 'anthropic/claude-sonnet',
      })
    }
    const [url, init] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url))
    expect(parsed.pathname).toBe('/api/public/v2/observations')
    expect(parsed.searchParams.get('limit')).toBe('15')
    expect(parsed.searchParams.get('type')).toBe('GENERATION')
    expect(parsed.searchParams.get('fields')).toBe('core,basic,model,usage,metrics')
    const expectedAuth = `Basic ${Buffer.from('pk-1:sk-1').toString('base64')}`
    expect(init.headers).toMatchObject({ Authorization: expectedAuth })
  })

  it('defaults latency/model/tokens when the optional fields are absent', async () => {
    mockFetchSequence([
      {
        ok: true,
        body: {
          data: [
            observation('2026-08-01T10:00:00Z', {
              latency: null,
              providedModelName: null,
              usageDetails: undefined,
              totalCost: undefined,
              name: undefined,
            }),
          ],
        },
      },
    ])
    const result = await getLangfuseTraces()
    expect(result.ok && result.data.traces[0]).toEqual({
      time: '2026-08-01T10:00:00Z',
      name: '(unnamed)',
      latencyMs: null,
      totalCost: 0,
      tokens: 0,
    })
  })

  it('drops rows without a start time', async () => {
    mockFetchSequence([
      { ok: true, body: { data: [{ id: 'x', name: 'no-time' }] } },
    ])
    const result = await getLangfuseTraces()
    expect(result.ok && result.data.traces).toEqual([])
  })

  it("returns 'unavailable' on a non-200", async () => {
    mockFetchSequence([{ ok: false, status: 500 }])
    expect(await getLangfuseTraces()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it("returns 'unavailable' when 'data' isn't an array", async () => {
    mockFetchSequence([{ ok: true, body: { data: 'nope' } }])
    expect(await getLangfuseTraces()).toEqual({ ok: false, reason: 'unavailable' })
  })
})
