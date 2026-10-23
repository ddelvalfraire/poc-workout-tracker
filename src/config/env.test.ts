import { afterEach, describe, expect, it, vi } from 'vitest'
import { langfuseApiBaseUrl, requireEnv, wgerApiBaseUrl } from './env'

afterEach(() => vi.unstubAllEnvs())

describe('required environment reads', () => {
  it.each([undefined, ''])('rejects a missing or empty value (%s)', (value) => {
    vi.stubEnv('CONFIG_TEST_REQUIRED', value)
    expect(() => requireEnv('CONFIG_TEST_REQUIRED')).toThrow(
      'Missing required environment variable: CONFIG_TEST_REQUIRED',
    )
  })

  it.each(['0', 'false', '  '])('preserves a nonempty value verbatim (%s)', (value) => {
    vi.stubEnv('CONFIG_TEST_REQUIRED', value)
    expect(requireEnv('CONFIG_TEST_REQUIRED')).toBe(value)
  })

  it('reads at call time, including after a value is removed', () => {
    vi.stubEnv('CONFIG_TEST_REQUIRED', 'first')
    expect(requireEnv('CONFIG_TEST_REQUIRED')).toBe('first')
    vi.stubEnv('CONFIG_TEST_REQUIRED', 'second')
    expect(requireEnv('CONFIG_TEST_REQUIRED')).toBe('second')
    vi.stubEnv('CONFIG_TEST_REQUIRED', undefined)
    expect(() => requireEnv('CONFIG_TEST_REQUIRED')).toThrow('CONFIG_TEST_REQUIRED')
  })

  it('loads before dotenv supplies database or storage credentials', async () => {
    for (const name of ['DATABASE_URL', 'DATABASE_URL_DIRECT', 'SUPABASE_SECRET_KEY']) {
      vi.stubEnv(name, undefined)
    }
    vi.resetModules()
    const config = await import('./env')
    expect(config.wgerApiBaseUrl({})).toBe('https://wger.de/api/v2')
    vi.stubEnv('DATABASE_URL_DIRECT', 'postgres://local-test')
    expect(config.requireEnv('DATABASE_URL_DIRECT')).toBe('postgres://local-test')
  })
})

describe('vendor hosts', () => {
  it.each([
    [undefined, 'https://wger.de/api/v2'],
    ['', ''],
    ['https://wger.example/api/v2/', 'https://wger.example/api/v2/'],
  ])('preserves wger override/fallback behavior (%s)', (value, expected) => {
    expect(wgerApiBaseUrl({ WGER_API_BASE_URL: value })).toBe(expected)
  })

  it.each([
    [undefined, 'https://cloud.langfuse.com'],
    ['', 'https://cloud.langfuse.com'],
    ['https://langfuse.example', 'https://langfuse.example'],
    ['https://langfuse.example/', 'https://langfuse.example'],
    ['https://langfuse.example//', 'https://langfuse.example/'],
  ])('preserves Langfuse override/fallback behavior (%s)', (value, expected) => {
    expect(langfuseApiBaseUrl({ LANGFUSE_BASEURL: value })).toBe(expected)
  })

  it('reads optional hosts from the current runtime environment', () => {
    vi.stubEnv('WGER_API_BASE_URL', 'https://first.example/api/v2')
    vi.stubEnv('LANGFUSE_BASEURL', 'https://first.example/')
    expect(wgerApiBaseUrl()).toBe('https://first.example/api/v2')
    expect(langfuseApiBaseUrl()).toBe('https://first.example')
    vi.stubEnv('WGER_API_BASE_URL', 'https://second.example/api/v2')
    vi.stubEnv('LANGFUSE_BASEURL', 'https://second.example/')
    expect(wgerApiBaseUrl()).toBe('https://second.example/api/v2')
    expect(langfuseApiBaseUrl()).toBe('https://second.example')
  })
})
