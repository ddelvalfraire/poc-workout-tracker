import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/redis', () => ({ getRedis: () => null }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it.each([
  [undefined, 'https://wger.de/api/v2'],
  ['https://wger.example/api/v2', 'https://wger.example/api/v2'],
])('uses the same configured host for exercise and template requests (%s)', async (setting, base) => {
  vi.stubEnv('WGER_API_BASE_URL', setting)
  vi.stubEnv('WGER_API_KEY', 'template-test-key')
  vi.resetModules()
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ results: [], next: null }))
  vi.stubGlobal('fetch', fetchMock)
  const { clearExerciseCache, getAllExercises } = await import('@/lib/exercises/wger')
  const { listPublicTemplates } = await import('@/lib/templates/wger-templates')
  clearExerciseCache()

  expect(await getAllExercises()).toEqual([])
  expect(await listPublicTemplates()).toEqual({ ok: true, templates: [] })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  const urls = fetchMock.mock.calls.map((call) => String(call[0]))
  expect(urls[0]).toBe(`${base}/exerciseinfo/?language=2&limit=999&format=json`)
  expect(urls[1]).toContain(`${base}/public-templates/`)
})
