import { describe, it, expect, vi, beforeEach } from 'vitest'
import { auth } from '@clerk/nextjs/server'
import { bytesToBase64 } from '@/lib/photo-input'
import { countProgressPhotos, insertProgressPhoto } from '@/db/progress-photos'
import { uploadObject, deleteObjects } from '@/lib/supabase-storage'
import { POST } from './route'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/db/progress-photos', () => ({
  countProgressPhotos: vi.fn(),
  insertProgressPhoto: vi.fn(),
}))
vi.mock('@/lib/supabase-storage', () => ({
  uploadObject: vi.fn(),
  deleteObjects: vi.fn(),
}))

const mockedAuth = vi.mocked(auth)
const mockedCount = vi.mocked(countProgressPhotos)
const mockedInsert = vi.mocked(insertProgressPhoto)
const mockedUpload = vi.mocked(uploadObject)
const mockedDelete = vi.mocked(deleteObjects)

function signedIn(userId: string | null): void {
  mockedAuth.mockResolvedValue({ userId } as unknown as Awaited<ReturnType<typeof auth>>)
}

/** A valid 16-byte WEBP header (RIFF....WEBP) — enough to pass the sniffer. */
function webpBlob(): Blob {
  const bytes = new Uint8Array(16)
  bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
  bytes.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8)
  return new Blob([bytes], { type: 'image/webp' })
}

/** A non-image payload masquerading as a webp Blob. */
function htmlBlob(): Blob {
  const bytes = new Uint8Array(16)
  bytes.set([...'<html><script>x'].map((c) => c.charCodeAt(0)), 0)
  return new Blob([bytes], { type: 'image/webp' })
}

const VALID_HASH = bytesToBase64(new Uint8Array(25))

function form(
  overrides: {
    display?: Blob
    thumb?: Blob
    thumbHash?: string
    pose?: string
    note?: string
  } = {},
): FormData {
  const fd = new FormData()
  fd.set('display', overrides.display ?? webpBlob())
  fd.set('thumb', overrides.thumb ?? webpBlob())
  fd.set('thumbHash', overrides.thumbHash ?? VALID_HASH)
  if (overrides.pose !== undefined) fd.set('pose', overrides.pose)
  if (overrides.note !== undefined) fd.set('note', overrides.note)
  return fd
}

function post(fd: FormData): Promise<Response> {
  return POST(new Request('http://localhost/api/photos', { method: 'POST', body: fd }))
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_123')
  mockedCount.mockResolvedValue(0)
  mockedInsert.mockResolvedValue({ id: 'p1' })
  mockedUpload.mockResolvedValue(undefined)
  mockedDelete.mockResolvedValue(undefined)
})

describe('POST /api/photos', () => {
  it('stores both blobs then inserts the row, returning 201', async () => {
    const res = await post(form({ pose: 'front', note: 'week 1' }))
    expect(res.status).toBe(201)
    expect(mockedUpload).toHaveBeenCalledTimes(2)
    expect(mockedInsert).toHaveBeenCalledTimes(1)
    // Row insert happens AFTER uploads.
    const insertOrder = mockedInsert.mock.invocationCallOrder[0]
    const uploadOrder = mockedUpload.mock.invocationCallOrder
    expect(insertOrder).toBeGreaterThan(Math.max(...uploadOrder))
  })

  it('returns 401 and touches nothing when unauthenticated', async () => {
    signedIn(null)
    const res = await post(form())
    expect(res.status).toBe(401)
    expect(mockedUpload).not.toHaveBeenCalled()
    expect(mockedInsert).not.toHaveBeenCalled()
  })

  it('returns 403 at the photo cap without uploading', async () => {
    mockedCount.mockResolvedValue(200)
    const res = await post(form())
    expect(res.status).toBe(403)
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it('rejects a payload whose magic bytes are not an image (415)', async () => {
    const res = await post(form({ display: htmlBlob() }))
    expect(res.status).toBe(415)
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it('rejects an invalid thumbHash (400)', async () => {
    const res = await post(form({ thumbHash: 'nope' }))
    expect(res.status).toBe(400)
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it('rejects an unknown pose (400)', async () => {
    const res = await post(form({ pose: 'forward' }))
    expect(res.status).toBe(400)
  })

  it('cleans up uploaded objects and 500s when the row insert fails', async () => {
    mockedInsert.mockRejectedValue(new Error('db down'))
    const res = await post(form())
    expect(res.status).toBe(500)
    expect(mockedDelete).toHaveBeenCalledTimes(1)
    const [keys] = mockedDelete.mock.calls[0]
    expect(keys).toHaveLength(2)
  })

  it('cleans up and 502s when the second upload fails', async () => {
    mockedUpload
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('storage down'))
    const res = await post(form())
    expect(res.status).toBe(502)
    expect(mockedInsert).not.toHaveBeenCalled()
    expect(mockedDelete).toHaveBeenCalledTimes(1)
  })
})
