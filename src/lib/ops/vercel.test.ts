import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getVercelDeployments } from './vercel'

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

const deployment = (state: string, createdAt: number, extra: Record<string, unknown> = {}) => ({
  uid: `dpl_${createdAt}`,
  name: 'poc-workout-tracker',
  url: `poc-workout-tracker-${createdAt}.vercel.app`,
  state,
  created: createdAt,
  createdAt,
  ready: createdAt + 45_000,
  meta: {
    githubCommitSha: 'abcdef1234567890',
    githubCommitMessage: 'feat: ship the thing\n\nlong body',
  },
  ...extra,
})

beforeEach(() => {
  vi.stubEnv('VERCEL_API_TOKEN', 'vtok')
  vi.stubEnv('VERCEL_PROJECT_ID', 'prj_123')
  vi.stubEnv('VERCEL_TEAM_ID', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getVercelDeployments', () => {
  it("returns 'unconfigured' without a token/project and never hits the network", async () => {
    vi.stubEnv('VERCEL_API_TOKEN', '')
    const fetchMock = mockFetchSequence([])

    expect(await getVercelDeployments()).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps commit sha/message/duration and queries 8 production deploys with Bearer auth', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, body: { deployments: [deployment('READY', 1000), deployment('ERROR', 900)] } },
    ])

    const result = await getVercelDeployments()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.deployments).toHaveLength(2)
      expect(result.data.deployments[0]).toEqual({
        state: 'READY',
        isFailed: false,
        sha7: 'abcdef1',
        commitMessage: 'feat: ship the thing',
        createdAt: 1000,
        durationMs: 45_000,
        url: 'poc-workout-tracker-1000.vercel.app',
      })
      expect(result.data.deployments[1].isFailed).toBe(true)
    }
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('projectId=prj_123')
    expect(String(url)).toContain('target=production')
    expect(String(url)).toContain('limit=8')
    expect(String(url)).not.toContain('teamId')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer vtok' })
  })

  it('flags CANCELED as failed and leaves duration null without a ready timestamp', async () => {
    mockFetchSequence([
      {
        ok: true,
        body: { deployments: [deployment('CANCELED', 500, { ready: undefined, meta: {} })] },
      },
    ])
    const result = await getVercelDeployments()
    expect(result.ok && result.data.deployments[0]).toMatchObject({
      isFailed: true,
      durationMs: null,
      sha7: '',
      commitMessage: '',
    })
  })

  it('adds teamId when VERCEL_TEAM_ID is set', async () => {
    vi.stubEnv('VERCEL_TEAM_ID', 'team_9')
    const fetchMock = mockFetchSequence([{ ok: true, body: { deployments: [] } }])
    await getVercelDeployments()
    expect(String(fetchMock.mock.calls[0][0])).toContain('teamId=team_9')
  })

  it('falls back to readyState/created for older payload shapes', async () => {
    mockFetchSequence([
      { ok: true, body: { deployments: [{ readyState: 'BUILDING', created: 1, url: 'x' }] } },
    ])
    const result = await getVercelDeployments()
    expect(result.ok && result.data.deployments[0]).toMatchObject({
      state: 'BUILDING',
      createdAt: 1,
      durationMs: null,
    })
  })

  it("returns 'unavailable' on a non-200", async () => {
    mockFetchSequence([{ ok: false, status: 403 }])
    expect(await getVercelDeployments()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it("returns 'unavailable' on a timeout / network error", async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('aborted')))
    expect(await getVercelDeployments()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it("returns 'unavailable' when 'deployments' is missing", async () => {
    mockFetchSequence([{ ok: true, body: { error: {} } }])
    expect(await getVercelDeployments()).toEqual({ ok: false, reason: 'unavailable' })
  })
})
