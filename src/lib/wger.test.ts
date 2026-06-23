import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchExercises, clearExerciseCache, type Exercise } from './wger'

// Control the Redis client per-test via a hoisted ref. Default `null` means
// "Redis not configured", so the existing tests below exercise the pure
// wger-fetch path exactly as before — and no test can ever reach real Upstash.
const { redisRef } = vi.hoisted(() => ({
  redisRef: { current: null as { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } | null },
}))
vi.mock('./redis', () => ({ getRedis: () => redisRef.current }))

const ENGLISH = 2
const GERMAN = 1

/** Builds a wger `exerciseinfo` result with only the fields the mapper reads. */
function makeInfo(
  id: number,
  name: string,
  category: string,
  equipment: string[],
  translations?: { name: string; language: number }[],
) {
  return {
    id,
    category: { id: 1, name: category },
    equipment: equipment.map((e, i) => ({ id: i + 1, name: e })),
    translations: translations ?? [{ name, language: ENGLISH }],
  }
}

/** Stubs `global.fetch` with a single ok response carrying the given body. */
function mockFetchOnce(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * Stubs `global.fetch` to return the given pages in order. Every page but the
 * last carries a non-null (same-host) `next` so the pagination loop keeps going.
 */
function mockFetchPages(pages: ReturnType<typeof makeInfo>[][]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn()
  pages.forEach((results, index) => {
    const next = index < pages.length - 1 ? `https://wger.de/next?page=${index + 1}` : null
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ next, results }) })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  clearExerciseCache()
  redisRef.current = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('searchExercises (wger proxy)', () => {
  it('maps a wger exercise to {id, name, category, equipment}', async () => {
    // Arrange
    mockFetchPages([[makeInfo(73, 'Bench Press', 'Chest', ['Barbell'])]])

    // Act
    const result = await searchExercises()

    // Assert
    expect(result).toEqual<Exercise[]>([
      { id: 73, name: 'Bench Press', category: 'Chest', equipment: ['Barbell'] },
    ])
  })

  it('omits equipment when the wger exercise has none', async () => {
    // Arrange
    mockFetchPages([[makeInfo(1, 'Pull Up', 'Back', [])]])

    // Act
    const result = await searchExercises()

    // Assert
    expect(result[0]).not.toHaveProperty('equipment')
  })

  it('picks the English (language 2) translation name', async () => {
    // Arrange — German entry first, English second
    mockFetchPages([
      [
        makeInfo(5, '', 'Legs', ['None'], [
          { name: 'Kniebeuge', language: GERMAN },
          { name: 'Squat', language: ENGLISH },
        ]),
      ],
    ])

    // Act
    const result = await searchExercises()

    // Assert
    expect(result[0].name).toBe('Squat')
  })

  it('drops exercises with no English translation', async () => {
    // Arrange
    mockFetchPages([
      [makeInfo(9, '', 'Legs', ['None'], [{ name: 'Kniebeuge', language: GERMAN }])],
    ])

    // Act
    const result = await searchExercises()

    // Assert
    expect(result).toHaveLength(0)
  })

  it('drops malformed records but keeps valid ones', async () => {
    // Arrange — a valid record alongside garbage entries
    mockFetchOnce({
      next: null,
      results: [
        makeInfo(1, 'Bench Press', 'Chest', ['Barbell']),
        { id: 'not-a-number', category: null }, // malformed
        null, // not an object
        { id: 2, category: { id: 1, name: 'Legs' }, equipment: [], translations: [] }, // no name
      ],
    })

    // Act
    const result = await searchExercises()

    // Assert
    expect(result).toEqual<Exercise[]>([
      { id: 1, name: 'Bench Press', category: 'Chest', equipment: ['Barbell'] },
    ])
  })

  it('filters by case-insensitive name substring', async () => {
    // Arrange
    mockFetchPages([
      [
        makeInfo(1, 'Bench Press', 'Chest', ['Barbell']),
        makeInfo(2, 'Deadlift', 'Legs', ['Barbell']),
        makeInfo(3, 'Incline Bench', 'Chest', ['Dumbbell']),
      ],
    ])

    // Act
    const result = await searchExercises({ search: 'BENCH' })

    // Assert
    expect(result.map((e) => e.name)).toEqual(['Bench Press', 'Incline Bench'])
  })

  it('filters by category (case-insensitive)', async () => {
    // Arrange
    mockFetchPages([
      [
        makeInfo(1, 'Bench Press', 'Chest', ['Barbell']),
        makeInfo(2, 'Deadlift', 'Legs', ['Barbell']),
      ],
    ])

    // Act
    const result = await searchExercises({ category: 'chest' })

    // Assert
    expect(result.map((e) => e.name)).toEqual(['Bench Press'])
  })

  it('clamps limit to the maximum and slices results', async () => {
    // Arrange — 120 exercises in one page
    const many = Array.from({ length: 120 }, (_, i) => makeInfo(i, `Ex ${i}`, 'Chest', []))
    mockFetchPages([many])

    // Act
    const capped = await searchExercises({ limit: 1000 })
    clearExerciseCache()
    mockFetchPages([many])
    const five = await searchExercises({ limit: 5 })

    // Assert
    expect(capped.length).toBeLessThanOrEqual(100)
    expect(five).toHaveLength(5)
  })

  it('follows pagination across pages', async () => {
    // Arrange — two pages
    const fetchMock = mockFetchPages([
      [makeInfo(1, 'Bench Press', 'Chest', ['Barbell'])],
      [makeInfo(2, 'Deadlift', 'Legs', ['Barbell'])],
    ])

    // Act
    const result = await searchExercises()

    // Assert
    expect(result).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches the catalog (second call does not refetch)', async () => {
    // Arrange
    const fetchMock = mockFetchPages([[makeInfo(1, 'Bench Press', 'Chest', ['Barbell'])]])

    // Act
    await searchExercises()
    await searchExercises({ search: 'bench' })

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent cold loads into a single upstream fetch', async () => {
    // Arrange — empty cache; one always-resolving page response.
    const fetchMock = mockFetchOnce({
      next: null,
      results: [makeInfo(1, 'Bench Press', 'Chest', ['Barbell'])],
    })

    // Act — two callers race before the catalog is populated.
    const [a, b] = await Promise.all([searchExercises(), searchExercises({ search: 'bench' })])

    // Assert — the in-flight load is shared, so wger is hit once, not twice.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toEqual([{ id: 1, name: 'Bench Press', category: 'Chest', equipment: ['Barbell'] }])
    expect(b).toEqual(a)
  })

  it('throws when wger responds non-ok', async () => {
    // Arrange
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    )

    // Act + Assert
    await expect(searchExercises()).rejects.toThrow(/wger request failed: 500/)
  })

  it('throws when the response is not a valid list object', async () => {
    // Arrange — body is a bare string, not { results: [...] }
    mockFetchOnce('not json')

    // Act + Assert
    await expect(searchExercises()).rejects.toThrow(/wger response/)
  })

  it('refuses to follow pagination to a foreign host', async () => {
    // Arrange — first page points `next` at an unexpected origin
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        next: 'https://evil.example.com/api/v2/exerciseinfo/?page=2',
        results: [makeInfo(1, 'Bench Press', 'Chest', ['Barbell'])],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    // Act + Assert
    await expect(searchExercises()).rejects.toThrow(/unexpected host/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  describe('Redis catalog cache', () => {
    it('serves from Redis without hitting wger on a cache hit', async () => {
      // Arrange — Redis has the mapped catalog; wger must not be called.
      const cached: Exercise[] = [{ id: 73, name: 'Bench Press', category: 'Chest' }]
      redisRef.current = { get: vi.fn().mockResolvedValue(cached), set: vi.fn() }
      const fetchMock = mockFetchPages([[makeInfo(1, 'Should Not Fetch', 'Chest', [])]])

      // Act
      const result = await searchExercises()

      // Assert
      expect(result).toEqual(cached)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('fetches from wger and backfills Redis on a cache miss', async () => {
      // Arrange — Redis returns null (miss); wger serves one exercise.
      const set = vi.fn().mockResolvedValue('OK')
      redisRef.current = { get: vi.fn().mockResolvedValue(null), set }
      mockFetchPages([[makeInfo(73, 'Bench Press', 'Chest', ['Barbell'])]])

      // Act
      const result = await searchExercises()

      // Assert
      expect(result).toEqual<Exercise[]>([
        { id: 73, name: 'Bench Press', category: 'Chest', equipment: ['Barbell'] },
      ])
      expect(set).toHaveBeenCalledWith(
        'wger:exercise-catalog:v1',
        result,
        expect.objectContaining({ ex: expect.any(Number) }),
      )
    })

    it('falls back to wger when the Redis read throws', async () => {
      // Arrange — Redis read errors; the app must still serve from wger.
      redisRef.current = { get: vi.fn().mockRejectedValue(new Error('redis down')), set: vi.fn() }
      mockFetchPages([[makeInfo(1, 'Deadlift', 'Legs', ['Barbell'])]])

      // Act
      const result = await searchExercises()

      // Assert
      expect(result.map((e) => e.name)).toEqual(['Deadlift'])
    })
  })
})
