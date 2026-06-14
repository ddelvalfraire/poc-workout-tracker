import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'
import { searchExercises } from '@/lib/wger'
import { auth } from '@clerk/nextjs/server'

vi.mock('@/lib/wger', () => ({ searchExercises: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))

const mockedSearch = vi.mocked(searchExercises)
const mockedAuth = vi.mocked(auth)

/** Sets the Clerk auth result for the next request. */
function signedIn(userId: string | null): void {
  mockedAuth.mockResolvedValue({ userId } as unknown as Awaited<ReturnType<typeof auth>>)
}

function get(query = ''): Promise<Response> {
  return GET(new Request(`http://localhost/api/exercises${query}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_123')
})

describe('GET /api/exercises', () => {
  it('returns the exercises as a JSON array', async () => {
    // Arrange
    const exercises = [{ id: 1, name: 'Bench Press', category: 'Chest' }]
    mockedSearch.mockResolvedValue(exercises)

    // Act
    const res = await get()

    // Assert
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(exercises)
  })

  it('returns 401 and does not query wger when unauthenticated', async () => {
    // Arrange
    signedIn(null)
    mockedSearch.mockResolvedValue([])

    // Act
    const res = await get()

    // Assert
    expect(res.status).toBe(401)
    expect(mockedSearch).not.toHaveBeenCalled()
  })

  it('forwards search, category, and limit query params to the service', async () => {
    // Arrange
    mockedSearch.mockResolvedValue([])

    // Act
    await get('?search=bench&category=Chest&limit=10')

    // Assert
    expect(mockedSearch).toHaveBeenCalledWith({ search: 'bench', category: 'Chest', limit: 10 })
  })

  it('passes undefined options when no query params are given', async () => {
    // Arrange
    mockedSearch.mockResolvedValue([])

    // Act
    await get()

    // Assert
    expect(mockedSearch).toHaveBeenCalledWith({
      search: undefined,
      category: undefined,
      limit: undefined,
    })
  })

  it('ignores a non-numeric or partially numeric limit', async () => {
    // Arrange
    mockedSearch.mockResolvedValue([])

    // Act
    await get('?limit=abc')
    await get('?limit=10abc')

    // Assert
    expect(mockedSearch).toHaveBeenNthCalledWith(1, expect.objectContaining({ limit: undefined }))
    expect(mockedSearch).toHaveBeenNthCalledWith(2, expect.objectContaining({ limit: undefined }))
  })

  it('returns 502 with an error message when the service throws', async () => {
    // Arrange
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedSearch.mockRejectedValue(new Error('wger down'))

    // Act
    const res = await get()

    // Assert
    expect(res.status).toBe(502)
    expect((await res.json()).error).toEqual(expect.any(String))
  })
})
