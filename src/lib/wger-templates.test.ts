import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listPublicTemplates, getRoutineStructure } from './wger-templates'

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

const summary = (id: number) => ({ id, name: `Routine ${id}`, is_public: true, is_template: true })
const structure = (id: number) => ({ id, name: `Routine ${id}`, days: [] })

beforeEach(() => {
  vi.stubEnv('WGER_API_KEY', 'test-key')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('listPublicTemplates', () => {
  it("returns 'unconfigured' without a WGER_API_KEY and never hits the network", async () => {
    vi.stubEnv('WGER_API_KEY', '')
    const fetchMock = mockFetchSequence([])

    const result = await listPublicTemplates()

    expect(result).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists templates with their structures, sending the token auth header', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, body: { count: 2, next: null, results: [summary(1), summary(2)] } },
      { ok: true, body: structure(1) },
      { ok: true, body: structure(2) },
    ])

    const result = await listPublicTemplates()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.templates.map((t) => t.id)).toEqual([1, 2])
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [listUrl, listInit] = fetchMock.mock.calls[0]
    expect(String(listUrl)).toContain('/public-templates/')
    expect(listInit.headers).toMatchObject({ Authorization: 'Token test-key' })
    expect(String(fetchMock.mock.calls[1][0])).toContain('/routine/1/structure/')
  })

  it("returns 'unavailable' when the list request fails", async () => {
    mockFetchSequence([{ ok: false, status: 503 }])

    const result = await listPublicTemplates()

    expect(result).toEqual({ ok: false, reason: 'unavailable' })
  })

  it("returns 'unavailable' on a malformed list payload", async () => {
    mockFetchSequence([{ ok: true, body: { nope: true } }])

    const result = await listPublicTemplates()

    expect(result).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('drops malformed summaries and failed structure fetches, keeping the rest', async () => {
    mockFetchSequence([
      {
        ok: true,
        body: { count: 3, next: null, results: [summary(1), { id: 'bad' }, summary(3)] },
      },
      { ok: false, status: 404 }, // routine 1's structure is gone
      { ok: true, body: structure(3) },
    ])

    const result = await listPublicTemplates()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.templates.map((t) => t.id)).toEqual([3])
    }
  })
})

describe('getRoutineStructure', () => {
  it('returns the validated structure', async () => {
    mockFetchSequence([{ ok: true, body: structure(7) }])

    const result = await getRoutineStructure(7)

    expect(result?.id).toBe(7)
  })

  it('returns null without a key, on upstream failure, or malformed payloads', async () => {
    vi.stubEnv('WGER_API_KEY', '')
    expect(await getRoutineStructure(7)).toBeNull()

    vi.stubEnv('WGER_API_KEY', 'test-key')
    mockFetchSequence([{ ok: false, status: 404 }])
    expect(await getRoutineStructure(7)).toBeNull()

    mockFetchSequence([{ ok: true, body: { name: 'no id' } }])
    expect(await getRoutineStructure(7)).toBeNull()
  })
})
