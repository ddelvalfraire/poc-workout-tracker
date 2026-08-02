import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getHealthchecks } from './healthchecks'

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

const check = (name: string, status: string) => ({
  name,
  status,
  last_ping: '2026-08-01T09:00:00Z',
  next_ping: '2026-08-02T09:00:00Z',
})

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

  it('maps checks, counts non-up as down, and sends X-Api-Key', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, body: { checks: [check('cron', 'up'), check('backup', 'down')] } },
    ])

    const result = await getHealthchecks()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.checks).toHaveLength(2)
      expect(result.data.downCount).toBe(1)
      expect(result.data.checks[0]).toMatchObject({ name: 'cron', status: 'up' })
    }
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://healthchecks.io/api/v3/checks/')
    expect(init.headers).toMatchObject({ 'X-Api-Key': 'hc-key' })
  })

  it("treats 'new' checks as not-down", async () => {
    mockFetchSequence([{ ok: true, body: { checks: [check('fresh', 'new')] } }])
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
