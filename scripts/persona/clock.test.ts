import { describe, expect, it } from 'vitest'
import { createClock } from './clock'

describe('createClock', () => {
  it('daysAgo(5) is exactly 5 days before the anchor', () => {
    const anchor = new Date('2026-01-10T00:00:00.000Z')
    const clock = createClock(anchor)
    expect(clock.daysAgo(5).getTime()).toBe(anchor.getTime() - 5 * 24 * 60 * 60 * 1000)
  })

  it('daysAgo(0) equals the anchor', () => {
    const anchor = new Date('2026-01-10T00:00:00.000Z')
    const clock = createClock(anchor)
    expect(clock.daysAgo(0).getTime()).toBe(anchor.getTime())
  })

  it('hoursAgo(1) is exactly one hour before the anchor', () => {
    const anchor = new Date('2026-01-10T00:00:00.000Z')
    const clock = createClock(anchor)
    expect(clock.hoursAgo(1).getTime()).toBe(anchor.getTime() - 60 * 60 * 1000)
  })
})
