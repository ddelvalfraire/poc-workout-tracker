import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getSentryIssues } from './sentry'

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
  count: String(n),
  permalink: `https://sentry.io/issues/${n}/`,
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

  it('counts issues, caps the top list at five, and sends Bearer auth', async () => {
    const fetchMock = mockFetchSequence([{ ok: true, body: [1, 2, 3, 4, 5, 6, 7].map(issue) }])

    const result = await getSentryIssues()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.unresolvedCount).toBe(7)
      expect(result.data.topIssues).toHaveLength(5)
      expect(result.data.topIssues[0].permalink).toBe('https://sentry.io/issues/1/')
    }
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/projects/david-1k/poc-workout-tracker/issues/')
    expect(String(url)).toContain('is%3Aunresolved')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' })
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
