import { describe, it, expect } from 'vitest'
import {
  lastRunLabel,
  sortTemplatesByUsage,
  templateStatusLine,
  templateUsageByName,
} from './template-usage'

const NOW = new Date('2026-07-20T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

/** One summary; overrides on top of a completed named run. */
function summary(over: Partial<Parameters<typeof templateUsageByName>[0][number]> = {}) {
  return {
    name: 'Push Day',
    startedAt: daysAgo(4),
    completedAt: daysAgo(4),
    volumeKg: 3663.2,
    ...over,
  }
}

describe('templateUsageByName (the documented name heuristic)', () => {
  it('keeps the newest COMPLETED run per name with its volume', () => {
    const usage = templateUsageByName([
      summary({ startedAt: daysAgo(10), volumeKg: 1000 }),
      summary({ startedAt: daysAgo(4), volumeKg: 2000 }),
      summary({ name: 'Leg Day', startedAt: daysAgo(2), volumeKg: 500 }),
    ])

    expect(usage.get('Push Day')).toEqual({ lastPerformedAt: daysAgo(4), lastVolumeKg: 2000 })
    expect(usage.get('Leg Day')?.lastVolumeKg).toBe(500)
  })

  it('never counts in-progress or unnamed workouts', () => {
    const usage = templateUsageByName([
      summary({ completedAt: null }),
      summary({ name: null, startedAt: daysAgo(1) }),
    ])

    expect(usage.size).toBe(0)
  })

  it('is exact-match only — a renamed workout honestly drops the link', () => {
    const usage = templateUsageByName([summary({ name: 'push day' })])
    expect(usage.get('Push Day')).toBeUndefined()
  })
})

describe('sortTemplatesByUsage', () => {
  it('orders last-performed desc, never-run after in incoming order', () => {
    const templates = [
      { name: 'Never A' },
      { name: 'Old' },
      { name: 'Fresh' },
      { name: 'Never B' },
    ]
    const usage = templateUsageByName([
      summary({ name: 'Old', startedAt: daysAgo(20) }),
      summary({ name: 'Fresh', startedAt: daysAgo(1) }),
    ])

    const ordered = sortTemplatesByUsage(templates, usage)

    expect(ordered.map((t) => t.name)).toEqual(['Fresh', 'Old', 'Never A', 'Never B'])
    expect(templates.map((t) => t.name)).toEqual(['Never A', 'Old', 'Fresh', 'Never B']) // input untouched
  })
})

describe('status line', () => {
  it('speaks relative words with unit-aware volume', () => {
    const usage = { lastPerformedAt: daysAgo(4), lastVolumeKg: 3663.2 }
    expect(templateStatusLine(usage, 5, 'lb', NOW)).toBe('Last: 4d ago · 8,076 lb')
    expect(templateStatusLine(usage, 5, 'kg', NOW)).toBe('Last: 4d ago · 3,663 kg')
  })

  it('drops a zero volume segment', () => {
    expect(
      templateStatusLine({ lastPerformedAt: daysAgo(1), lastVolumeKg: 0 }, 5, 'kg', NOW),
    ).toBe('Last: Yesterday')
  })

  it('reads honest Never run with the exercise count when nothing matched', () => {
    expect(templateStatusLine(null, 1, 'kg', NOW)).toBe('1 exercise · Never run')
    expect(templateStatusLine(null, 8, 'kg', NOW)).toBe('8 exercises · Never run')
  })

  it('scales the relative words with age', () => {
    expect(lastRunLabel(daysAgo(0), NOW)).toBe('Today')
    expect(lastRunLabel(daysAgo(6), NOW)).toBe('6d ago')
    expect(lastRunLabel(daysAgo(35), NOW)).toBe('5 wks ago')
    expect(lastRunLabel(daysAgo(120), NOW)).toBe('4 mo ago')
  })
})
