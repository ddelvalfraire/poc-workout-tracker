import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getUserId } from '@/lib/auth'
import { planImport, commitImport, ImportPlanError, type ImportPlan } from '@/db/import'
import { loadPreview, deletePreview } from '@/lib/import/preview-cache'
import type { ParsedImport } from '@/lib/import/types'
import { POST } from './route'

vi.mock('@/lib/auth', () => ({ getUserId: vi.fn() }))
vi.mock('@/db/import', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/import')>()
  return { ...original, planImport: vi.fn(), commitImport: vi.fn(), undoImport: vi.fn() }
})
vi.mock('@/lib/import/preview-cache', () => ({
  storePreview: vi.fn(),
  loadPreview: vi.fn(),
  deletePreview: vi.fn(),
}))

const mockedGetUserId = vi.mocked(getUserId)
const mockedPlan = vi.mocked(planImport)
const mockedCommit = vi.mocked(commitImport)
const mockedLoad = vi.mocked(loadPreview)
const mockedDelete = vi.mocked(deletePreview)

function signedIn(userId: string | null): void {
  mockedGetUserId.mockResolvedValue(userId)
}

const TOKEN = '11111111-2222-3333-4444-555555555555'

const parsedFixture: ParsedImport = {
  source: 'strong',
  sourceUnit: 'kg',
  workouts: [],
  skipped: [],
  warnings: [],
}

const planFixture = { workoutCount: 1, setCount: 1 } as unknown as ImportPlan

function request(body: unknown): Request {
  return new Request('http://localhost/api/import/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_123')
  mockedLoad.mockResolvedValue({ parsed: parsedFixture, fileName: 'export.csv' })
  mockedPlan.mockResolvedValue(planFixture)
  mockedCommit.mockResolvedValue({
    batchId: 'batch-1',
    workoutsImported: 1,
    setsImported: 1,
    duplicatesSkipped: 0,
    customsCreated: 0,
  })
})

describe('POST /api/import/commit', () => {
  it('rejects unauthenticated requests', async () => {
    signedIn(null)
    const response = await POST(request({ token: TOKEN }))
    expect(response.status).toBe(401)
  })

  it('rejects a malformed JSON body', async () => {
    const response = await POST(request('not json'))
    expect(response.status).toBe(400)
  })

  it('rejects a missing or non-uuid token', async () => {
    expect((await POST(request({}))).status).toBe(400)
    expect((await POST(request({ token: 'abc' }))).status).toBe(400)
  })

  it('returns 410 when the preview expired (cache miss)', async () => {
    mockedLoad.mockResolvedValue(null)
    const response = await POST(request({ token: TOKEN }))
    expect(response.status).toBe(410)
    expect(mockedCommit).not.toHaveBeenCalled()
  })

  it('re-plans from the cached parse and commits, single-use token', async () => {
    const response = await POST(request({ token: TOKEN }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      batchId: 'batch-1',
      workoutsImported: 1,
      setsImported: 1,
      duplicatesSkipped: 0,
      customsCreated: 0,
    })
    // Shared dry-run/commit path: the SAME planImport, fed the cached parse.
    expect(mockedPlan).toHaveBeenCalledWith('user_123', parsedFixture)
    expect(mockedCommit).toHaveBeenCalledWith('user_123', planFixture, 'export.csv')
    expect(mockedDelete).toHaveBeenCalledWith('user_123', TOKEN)
  })

  it('keeps the token on failure so the user can retry', async () => {
    mockedCommit.mockRejectedValue(new Error('db down'))
    const response = await POST(request({ token: TOKEN }))
    expect(response.status).toBe(500)
    expect(mockedDelete).not.toHaveBeenCalled()
  })

  it('surfaces plan policy errors as 422', async () => {
    mockedPlan.mockRejectedValue(new ImportPlanError('too many customs'))
    const response = await POST(request({ token: TOKEN }))
    expect(response.status).toBe(422)
  })
})
