import { describe, it, expect } from 'vitest'
import manifest from './manifest'

describe('manifest', () => {
  it('declares the app name and short name', () => {
    const result = manifest()
    expect(result.name).toBe('Workout Tracker')
    expect(result.short_name).toBeTruthy()
  })

  it('is a standalone installable app rooted at /', () => {
    const result = manifest()
    expect(result.display).toBe('standalone')
    expect(result.start_url).toBe('/')
  })

  it('provides 192 + 512 icons with both an "any" and a "maskable" purpose', () => {
    const icons = manifest().icons ?? []
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
