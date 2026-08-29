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

/**
 * The decision only: which of the three status sentences a row earns, and
 * the numbers inside it. The words are proved rendered through the real
 * catalog in templates-i18n.test.tsx.
 */
describe('status descriptors', () => {
  it('carries the recency message and the volume in the display unit', () => {
    const usage = { lastPerformedAt: daysAgo(4), lastVolumeKg: 3663.2 }
    expect(templateStatusLine(usage, 5, 'lb', NOW)).toEqual({
      key: 'status.lastRunVolume',
      values: { when: { key: 'lastRun.daysAgo', values: { days: 4 } }, volume: 8076, unit: 'lb' },
    })
    expect(templateStatusLine(usage, 5, 'kg', NOW)).toEqual({
      key: 'status.lastRunVolume',
      values: { when: { key: 'lastRun.daysAgo', values: { days: 4 } }, volume: 3663, unit: 'kg' },
    })
  })

  it('picks the volume-less sentence when nothing was loaded', () => {
    expect(
      templateStatusLine({ lastPerformedAt: daysAgo(1), lastVolumeKg: 0 }, 5, 'kg', NOW),
    ).toEqual({ key: 'status.lastRun', values: { when: { key: 'lastRun.yesterday' } } })
  })

  it('reads honest Never run with the exercise count, at one and at many', () => {
    expect(templateStatusLine(null, 1, 'kg', NOW)).toEqual({
      key: 'status.neverRun',
      values: { count: 1 },
    })
    expect(templateStatusLine(null, 8, 'kg', NOW)).toEqual({
      key: 'status.neverRun',
      values: { count: 8 },
    })
  })

  it('scales the relative message with age', () => {
    expect(lastRunLabel(daysAgo(0), NOW)).toEqual({ key: 'lastRun.today' })
    expect(lastRunLabel(daysAgo(1), NOW)).toEqual({ key: 'lastRun.yesterday' })
    expect(lastRunLabel(daysAgo(6), NOW)).toEqual({ key: 'lastRun.daysAgo', values: { days: 6 } })
    expect(lastRunLabel(daysAgo(35), NOW)).toEqual({
      key: 'lastRun.weeksAgo',
      values: { weeks: 5 },
    })
    expect(lastRunLabel(daysAgo(120), NOW)).toEqual({
      key: 'lastRun.monthsAgo',
      values: { months: 4 },
    })
  })
})
