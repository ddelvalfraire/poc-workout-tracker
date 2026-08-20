import { describe, it, expect, vi } from 'vitest'

// The test env resolves next-intl/server to its client build, which throws.
// Fed the REAL catalog so the assertions still check the shipped strings.
vi.mock('next-intl/server', async () => {
  const messages = (await import('../../messages/en.json')).default
  return {
    getTranslations: async (namespace: keyof typeof messages) => (key: string) =>
      (messages[namespace] as Record<string, string>)[key],
  }
})
import manifest from './manifest'

describe('manifest', () => {
  it('declares the app name and short name', async () => {
    const result = await manifest()
    expect(result.name).toBe('Workout Tracker')
    expect(result.short_name).toBeTruthy()
  })

  it('is a standalone installable app rooted at /', async () => {
    const result = await manifest()
    expect(result.display).toBe('standalone')
    expect(result.start_url).toBe('/')
  })

  it('provides 192 + 512 icons with both an "any" and a "maskable" purpose', async () => {
    const icons = (await manifest()).icons ?? []
    const sizes = icons.map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')

    // Installability needs an "any" icon; Android adaptive icons need a
    // "maskable" one — and a large (512) "any" icon must exist, not only a
    // maskable one (a maskable-only icon renders padded in "any" contexts).
    const purposes = icons.map((icon) => icon.purpose ?? '')
    expect(purposes.some((p) => p.includes('any'))).toBe(true)
    expect(purposes.some((p) => p.includes('maskable'))).toBe(true)
    const anyAt512 = icons.some(
      (icon) => icon.sizes === '512x512' && (icon.purpose ?? '').includes('any'),
    )
    expect(anyAt512).toBe(true)
  })
})
