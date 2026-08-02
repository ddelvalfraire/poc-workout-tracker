import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getLangfuseDaily } from './langfuse'

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

  it('sums traces/cost/tokens across days and sends Basic auth to the metrics endpoint', async () => {
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
    expect(String(url)).toBe('https://us.cloud.langfuse.com/api/public/metrics/daily?limit=7')
    const expectedAuth = `Basic ${Buffer.from('pk-1:sk-1').toString('base64')}`
    expect(init.headers).toMatchObject({ Authorization: expectedAuth })
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
