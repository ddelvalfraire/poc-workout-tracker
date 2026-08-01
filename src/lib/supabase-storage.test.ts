import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSignedUrls, deleteObjects, uploadObject } from './supabase-storage'

/** The helper talks to storage/v1 over plain fetch; mock the global. */
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test')
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function ok(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('uploadObject', () => {
  it('POSTs to the object endpoint with the secret key as bearer + apikey', async () => {
    fetchMock.mockResolvedValue(ok())
    await uploadObject('user/p/display.webp', new ArrayBuffer(8), 'image/webp')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://project.supabase.co/storage/v1/object/progress-photos/user/p/display.webp',
    )
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sb_secret_test')
    expect(init.headers.apikey).toBe('sb_secret_test')
    expect(init.headers['x-upsert']).toBe('false')
  })

  it('throws with the status on a non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))
    await expect(uploadObject('k', new ArrayBuffer(1), 'image/webp')).rejects.toThrow('500')
  })
})

describe('deleteObjects', () => {
  it('is a no-op (no request) for an empty key list', async () => {
    await deleteObjects([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('DELETEs with the prefixes payload', async () => {
    fetchMock.mockResolvedValue(ok())
    await deleteObjects(['a/x.webp', 'a/y.webp'])
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ prefixes: ['a/x.webp', 'a/y.webp'] })
  })

  it('throws on API failure so a rollback caller can log it', async () => {
    fetchMock.mockResolvedValue(new Response('no', { status: 403 }))
    await expect(deleteObjects(['k'])).rejects.toThrow('403')
  })
})

describe('createSignedUrls', () => {
  it('returns an empty map without a request for no keys', async () => {
    const map = await createSignedUrls([])
    expect(map.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps each key to an absolute signed URL', async () => {
    fetchMock.mockResolvedValue(
      ok([
        {
          path: 'a/thumb.webp',
          signedURL: '/object/sign/progress-photos/a/thumb.webp?token=t1',
          error: null,
        },
        {
          path: 'a/display.webp',
          signedURL: '/object/sign/progress-photos/a/display.webp?token=t2',
          error: null,
        },
      ]),
    )
    const map = await createSignedUrls(['a/thumb.webp', 'a/display.webp'])
    expect(map.get('a/thumb.webp')).toBe(
      'https://project.supabase.co/storage/v1/object/sign/progress-photos/a/thumb.webp?token=t1',
    )
    expect(map.get('a/display.webp')).toContain('token=t2')
  })

  it('omits keys the API errored on (caller degrades to placeholder)', async () => {
    fetchMock.mockResolvedValue(
      ok([
        { path: 'a/thumb.webp', signedURL: '/object/sign/x?token=t1', error: null },
        { path: 'a/gone.webp', signedURL: null, error: 'Object not found' },
      ]),
    )
    const map = await createSignedUrls(['a/thumb.webp', 'a/gone.webp'])
    expect(map.has('a/thumb.webp')).toBe(true)
    expect(map.has('a/gone.webp')).toBe(false)
  })
})
