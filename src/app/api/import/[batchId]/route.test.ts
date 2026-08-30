import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getUserId } from '@/lib/auth/auth'
import { undoImport } from '@/db/import'
import { DELETE } from './route'

vi.mock('@/lib/auth/auth', () => ({ getUserId: vi.fn() }))
vi.mock('@/db/import', () => ({ undoImport: vi.fn() }))

const mockedGetUserId = vi.mocked(getUserId)
const mockedUndo = vi.mocked(undoImport)

function signedIn(userId: string | null): void {
  mockedGetUserId.mockResolvedValue(userId)
}

const BATCH_ID = '4f2b0f4e-1111-2222-3333-444455556666'

function call(batchId: string) {
  return DELETE(new Request(`http://localhost/api/import/${batchId}`, { method: 'DELETE' }), {
    params: Promise.resolve({ batchId }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_123')
  mockedUndo.mockResolvedValue({ workoutsDeleted: 3 })
})

describe('DELETE /api/import/[batchId]', () => {
  it('rejects unauthenticated requests', async () => {
    signedIn(null)
    expect((await call(BATCH_ID)).status).toBe(401)
    expect(mockedUndo).not.toHaveBeenCalled()
  })

  it('404s a malformed id without touching the db', async () => {
    expect((await call('not-a-uuid')).status).toBe(404)
    expect(mockedUndo).not.toHaveBeenCalled()
  })

  it("404s another user's (or a missing) batch", async () => {
    mockedUndo.mockResolvedValue(null)
    expect((await call(BATCH_ID)).status).toBe(404)
  })

  it('undoes an owned batch and reports the delete count', async () => {
    const response = await call(BATCH_ID)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ workoutsDeleted: 3 })
    expect(mockedUndo).toHaveBeenCalledWith('user_123', BATCH_ID)
  })

  it('maps db failures to a 500 with a generic message', async () => {
    mockedUndo.mockRejectedValue(new Error('db down'))
    const response = await call(BATCH_ID)
    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe('Failed to remove import')
  })
})
