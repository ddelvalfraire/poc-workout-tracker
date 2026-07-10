import { describe, it, expect } from 'vitest'
import { sparklinePoints } from './sparkline'

describe('sparklinePoints', () => {
  it('returns empty for fewer than 2 points (no line to draw)', () => {
    expect(sparklinePoints([], 100, 64)).toBe('')
    expect(sparklinePoints([82.5], 100, 64)).toBe('')
  })

  it('maps the two-point case to the box corners (min at bottom, max at top)', () => {
    // Arrange/Act — rising series: first point bottom-left, second top-right
    const points = sparklinePoints([80, 90], 100, 64)

    // Assert — SVG y grows downward: min → y=height, max → y=0
    expect(points).toBe('0,64 100,0')
  })

  it('normalizes intermediate values linearly across the range', () => {
    // 80 → bottom, 85 → middle, 90 → top; x spread evenly over the width
    const points = sparklinePoints([80, 85, 90], 100, 64)

    expect(points).toBe('0,64 50,32 100,0')
  })

  it('draws a flat series as a midline instead of dividing by zero', () => {
    const points = sparklinePoints([82, 82, 82], 100, 64)

    expect(points).toBe('0,32 50,32 100,32')
  })

  it('rounds coordinates to 2 decimals (compact attribute)', () => {
    // 4 points over width 100 → x step 33.333… → 33.33
    const points = sparklinePoints([1, 2, 3, 4], 100, 60)

    const [, second] = points.split(' ')
    expect(second).toBe('33.33,40')
  })
})
