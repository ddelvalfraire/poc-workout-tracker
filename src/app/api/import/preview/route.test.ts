import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { planImport, ImportPlanError, type ImportPlan } from '@/db/import'
import { storePreview } from '@/lib/import/preview-cache'
import { POST } from './route'

vi.mock('@/lib/auth', () => ({ getUserId: vi.fn() }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))
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
const mockedUnit = vi.mocked(getWeightUnit)
const mockedPlan = vi.mocked(planImport)
const mockedStore = vi.mocked(storePreview)

function signedIn(userId: string | null): void {
  mockedGetUserId.mockResolvedValue(userId)
}

// Synthetic fixture — never a real export.
const STRONG_CSV = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  '2024-01-15 17:32:11,Push Day,45m,Bench Press (Barbell),1,100,5,,,,,',
].join('\n')

function planFixture(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return {
    source: 'strong',
    sourceUnit: 'kg',
    workouts: [],
    resolutions: new Map(),
    matched: [{ importName: 'Bench Press (Barbell)', source: 'wger', id: 73, name: 'Bench Press' }],
    toCreate: [],
    duplicates: [],
    skipped: [],
    warnings: [],
    workoutCount: 1,
    setCount: 1,
    dateRange: {
      from: new Date('2024-01-15T17:32:11.000Z'),
      to: new Date('2024-01-15T17:32:11.000Z'),
    },
    ...overrides,
  }
}

function request(form: FormData): Request {
  return new Request('http://localhost/api/import/preview', { method: 'POST', body: form })
}

function fileForm(content: string, unit?: string): FormData {
  const form = new FormData()
  form.set('file', new File([content], 'export.csv', { type: 'text/csv' }))
  if (unit !== undefined) form.set('unit', unit)
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_123')
  mockedUnit.mockResolvedValue('kg')
  mockedPlan.mockResolvedValue(planFixture())
  mockedStore.mockResolvedValue('11111111-2222-3333-4444-555555555555')
})

describe('POST /api/import/preview', () => {
  it('rejects unauthenticated requests', async () => {
    signedIn(null)
    const response = await POST(request(fileForm(STRONG_CSV)))
    expect(response.status).toBe(401)
  })

  it('rejects non-multipart bodies', async () => {
    const response = await POST(
      new Request('http://localhost/api/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    )
    expect(response.status).toBe(400)
  })

  it('rejects a missing file', async () => {
    const response = await POST(request(new FormData()))
    expect(response.status).toBe(400)
  })

  it('rejects oversized files with 413', async () => {
    // A real 20MB+1 payload: a faked `size` property would not survive the
    // multipart round-trip through Request.formData().
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]))
    const response = await POST(request(form))
    expect(response.status).toBe(413)
  })

  it('rejects an invalid unit', async () => {
    const response = await POST(request(fileForm(STRONG_CSV, 'stone')))
    expect(response.status).toBe(400)
  })

  it('rejects unrecognized formats with 422 and never writes', async () => {
    const response = await POST(request(fileForm('name,email\nalice,alice@example.com')))
    expect(response.status).toBe(422)
    expect(mockedPlan).not.toHaveBeenCalled()
  })

  it('surfaces the custom-cap policy error as 422', async () => {
    mockedPlan.mockRejectedValue(new ImportPlanError('too many customs'))
    const response = await POST(request(fileForm(STRONG_CSV)))
    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe('too many customs')
  })

  it('returns 503 when the preview cache is unavailable', async () => {
    mockedStore.mockResolvedValue(null)
    const response = await POST(request(fileForm(STRONG_CSV)))
    expect(response.status).toBe(503)
  })

  it('returns the plan summary with a confirm token on success', async () => {
    const response = await POST(request(fileForm(STRONG_CSV, 'lb')))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      token: '11111111-2222-3333-4444-555555555555',
      source: 'strong',
      unitFromFile: false,
      fileName: 'export.csv',
      workoutCount: 1,
      setCount: 1,
      duplicateCount: 0,
      skippedCount: 0,
      toCreate: [],
      warnings: [],
    })
    expect(body.matched).toEqual([
      { importName: 'Bench Press (Barbell)', name: 'Bench Press', source: 'wger' },
    ])
    // The parsed payload was stashed for the commit half.
    expect(mockedStore).toHaveBeenCalledWith(
      'user_123',
      expect.objectContaining({ fileName: 'export.csv' }),
    )
  })

  it('falls back to the stored display unit when none is sent', async () => {
    await POST(request(fileForm(STRONG_CSV)))
    expect(mockedUnit).toHaveBeenCalledWith('user_123')
  })
})
