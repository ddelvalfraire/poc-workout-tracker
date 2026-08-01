import { describe, it, expect, vi, beforeEach } from 'vitest'
import { auth } from '@clerk/nextjs/server'
import { deleteProgressPhoto } from '@/db/progress-photos'
import { deleteObjects } from '@/lib/supabase-storage'
import { DELETE } from './route'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/db/progress-photos', () => ({ deleteProgressPhoto: vi.fn() }))
vi.mock('@/lib/supabase-storage', () => ({ deleteObjects: vi.fn() }))

const mockedAuth = vi.mocked(auth)
const mockedDeleteRow = vi.mocked(deleteProgressPhoto)
const mockedDeleteObjects = vi.mocked(deleteObjects)

const VALID_ID = '11111111-2222-3333-4444-555555555555'

function signedIn(userId: string | null): void {
  mockedAuth.mockResolvedValue({ userId } as unknown as Awaited<ReturnType<typeof auth>>)
}

function del(id: string): Promise<Response> {
  return DELETE(new Request(`http://localhost/api/photos/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_123')
  mockedDeleteObjects.mockResolvedValue(undefined)
})

describe('DELETE /api/photos/[id]', () => {
  it('deletes the owned row then removes both blobs', async () => {
    mockedDeleteRow.mockResolvedValue({
      id: VALID_ID,
      blobKeyDisplay: 'user_123/p/display.webp',
      blobKeyThumb: 'user_123/p/thumb.webp',
    })
    const res = await del(VALID_ID)
    expect(res.status).toBe(200)
    expect(mockedDeleteObjects).toHaveBeenCalledWith([
      'user_123/p/display.webp',
      'user_123/p/thumb.webp',
    ])
  })

  it('returns 401 and does not query when unauthenticated', async () => {
    signedIn(null)
    const res = await del(VALID_ID)
    expect(res.status).toBe(401)
    expect(mockedDeleteRow).not.toHaveBeenCalled()
  })

  it('returns 404 for a non-uuid id without querying', async () => {
    const res = await del('not-a-uuid')
    expect(res.status).toBe(404)
    expect(mockedDeleteRow).not.toHaveBeenCalled()
  })

  it('returns 404 when the row is not owned (or gone)', async () => {
    mockedDeleteRow.mockResolvedValue(null)
    const res = await del(VALID_ID)
    expect(res.status).toBe(404)
    expect(mockedDeleteObjects).not.toHaveBeenCalled()
  })

  it('still succeeds (row is gone) when blob removal fails', async () => {
    mockedDeleteRow.mockResolvedValue({
      id: VALID_ID,
      blobKeyDisplay: 'user_123/p/display.webp',
      blobKeyThumb: 'user_123/p/thumb.webp',
    })
    mockedDeleteObjects.mockRejectedValue(new Error('storage down'))
    const res = await del(VALID_ID)
    expect(res.status).toBe(200)
  })
})
