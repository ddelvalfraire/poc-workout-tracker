import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getSentryIssues } from './sentry'

// Pin the ops cache to passthrough: these tests assert vendor fetch
// behavior, not caching (cache.test.ts covers that).
vi.mock('@/lib/redis', () => ({ getRedis: () => null }))

/** Queues fetch responses in call order; each is `{ ok, status, body }`. */
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

const issue = (n: number) => ({
  title: `Error ${n}`,
  level: 'warning',
  culprit: `app/api/route-${n}`,
  count: String(n),
  userCount: n,
  permalink: `https://sentry.io/issues/${n}/`,
  firstSeen: '2026-07-25T12:00:00Z',
  lastSeen: '2026-08-01T12:00:00Z',
})

beforeEach(() => {
  vi.stubEnv('SENTRY_API_TOKEN', 'tok')
  vi.stubEnv('SENTRY_ORG_SLUG', 'david-1k')
  vi.stubEnv('SENTRY_PROJECT_SLUG', 'poc-workout-tracker')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getSentryIssues', () => {
  it("returns 'unconfigured' without a token and never hits the network", async () => {
    vi.stubEnv('SENTRY_API_TOKEN', '')
    const fetchMock = mockFetchSequence([])

    expect(await getSentryIssues()).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns 'unconfigured' when only the project slug is missing", async () => {
    vi.stubEnv('SENTRY_PROJECT_SLUG', '')
    const fetchMock = mockFetchSequence([])
    expect(await getSentryIssues()).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps triage fields, caps the top list at ten, and sends Bearer auth', async () => {
    const issues = Array.from({ length: 12 }, (_, i) => issue(i + 1))
    const fetchMock = mockFetchSequence([{ ok: true, body: issues }])

    const result = await getSentryIssues()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.unresolvedCount).toBe(12)
      expect(result.data.topIssues).toHaveLength(10)
      expect(result.data.period).toBe('24h')
      expect(result.data.topIssues[0]).toEqual({
        title: 'Error 1',
        level: 'warning',
        culprit: 'app/api/route-1',
        count: '1',
        userCount: 1,
        permalink: 'https://sentry.io/issues/1/',
        firstSeen: '2026-07-25T12:00:00Z',
        lastSeen: '2026-08-01T12:00:00Z',
      })
    }
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/projects/david-1k/poc-workout-tracker/issues/')
    expect(String(url)).toContain('is%3Aunresolved')
    expect(String(url)).toContain('statsPeriod=24h')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  it("queries statsPeriod=14d when the period is '14d'", async () => {
    const fetchMock = mockFetchSequence([{ ok: true, body: [issue(1)] }])
    const result = await getSentryIssues('14d')
    expect(String(fetchMock.mock.calls[0][0])).toContain('statsPeriod=14d')
    expect(result.ok && result.data.period).toBe('14d')
  })

  it('defaults level/culprit/userCount when absent', async () => {
    mockFetchSequence([
      { ok: true, body: [{ title: 'Bare', permalink: 'https://sentry.io/issues/9/' }] },
    ])
    const result = await getSentryIssues()
    expect(result.ok && result.data.topIssues[0]).toMatchObject({
      level: 'error',
      culprit: '',
      userCount: 0,
      firstSeen: '',
    })
  })

  it("returns 'unavailable' on a non-200", async () => {
    mockFetchSequence([{ ok: false, status: 403 }])
    expect(await getSentryIssues()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it("returns 'unavailable' on a timeout / network error", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('aborted'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getSentryIssues()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it("returns 'unavailable' when the payload isn't an array", async () => {
    mockFetchSequence([{ ok: true, body: { detail: 'nope' } }])
    expect(await getSentryIssues()).toEqual({ ok: false, reason: 'unavailable' })
  })
})
