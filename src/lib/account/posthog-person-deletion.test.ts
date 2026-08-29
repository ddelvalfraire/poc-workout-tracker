import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { deletePosthogPerson } from './posthog-person-deletion'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'phx_test')
  vi.stubEnv('POSTHOG_PROJECT_ID', '123')
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) }
}

describe('deletePosthogPerson', () => {
  it('skips honestly when the private API pair is not configured', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', '')
    await expect(deletePosthogPerson('user_1')).resolves.toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('looks up by distinct_id then deletes with delete_events=true', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42 }] }))
      .mockResolvedValueOnce(jsonResponse({}))

    await expect(deletePosthogPerson('user_1')).resolves.toBe('deleted')

    const [lookupUrl, lookupInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(lookupUrl).toBe('https://us.posthog.com/api/projects/123/persons?distinct_id=user_1')
    expect((lookupInit.headers as Record<string, string>).Authorization).toBe('Bearer phx_test')

    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(deleteUrl).toBe('https://us.posthog.com/api/projects/123/persons/42/?delete_events=true')
    expect(deleteInit.method).toBe('DELETE')
  })

  it('reports not_found when no person carries the distinct id (never-identified user)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }))
    await expect(deletePosthogPerson('user_1')).resolves.toBe('not_found')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws on API failure — propagation evidence must never be forged', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500))
    await expect(deletePosthogPerson('user_1')).rejects.toThrow(/lookup failed \(500\)/)

    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42 }] }))
      .mockResolvedValueOnce(jsonResponse({}, false, 403))
    await expect(deletePosthogPerson('user_1')).rejects.toThrow(/delete failed \(403\)/)
  })
})
