import { describe, it, expect } from 'vitest'
import { fitWithin, DISPLAY_MAX_EDGE, THUMB_MAX_EDGE } from './photo-pipeline'

/**
 * Only the pure dimension math is unit-tested here: preparePhoto needs
 * createImageBitmap + canvas, which jsdom/node don't provide (that path is
 * covered by the route + E2E). fitWithin is the load-bearing geometry.
 */
describe('fitWithin', () => {
  it('leaves an already-small image untouched (never upscales)', () => {
    expect(fitWithin(400, 300, DISPLAY_MAX_EDGE)).toEqual({ width: 400, height: 300 })
  })

  it('scales a landscape image so the long edge hits the cap', () => {
    expect(fitWithin(4000, 2000, DISPLAY_MAX_EDGE)).toEqual({ width: 1080, height: 540 })
  })

  it('scales a portrait image so the tall edge hits the cap', () => {
    expect(fitWithin(2000, 4000, THUMB_MAX_EDGE)).toEqual({ width: 160, height: 320 })
  })

  it('keeps aspect ratio and rounds to whole pixels', () => {
    const { width, height } = fitWithin(3000, 1999, THUMB_MAX_EDGE)
    expect(width).toBe(320)
    expect(height).toBe(213) // 1999 * (320/3000) = 213.2 → 213
  })

  it('never collapses a sliver edge below 1px', () => {
    const { height } = fitWithin(5000, 3, THUMB_MAX_EDGE)
    expect(height).toBe(1)
  })

  it('handles an exact-cap edge as a no-op', () => {
    expect(fitWithin(THUMB_MAX_EDGE, 100, THUMB_MAX_EDGE)).toEqual({ width: 320, height: 100 })
  })
})
