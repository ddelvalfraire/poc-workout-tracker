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

  it('provides 192 and 512 icons including a maskable one', () => {
    const icons = manifest().icons ?? []
    const sizes = icons.map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(icons.some((icon) => (icon.purpose ?? '').includes('maskable'))).toBe(true)
  })
})
