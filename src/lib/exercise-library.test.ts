import { describe, it, expect } from 'vitest'
import {
  compareLibraryEntries,
  e1rmDeltaChip,
  e1rmStatusBase,
  exerciseZone,
  libraryHref,
  parseLibraryParams,
  recencyLabel,
  sessionCountLine,
} from './exercise-library'

const NOW = new Date('2026-07-20T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

describe('exerciseZone', () => {
  it('is DORMANT past 4 weeks of silence, even with an old PR on file', () => {
    const zone = exerciseZone(
      { lastPerformedAt: daysAgo(29), lastPrAt: daysAgo(29), trendDeltaKg: 5 },
      NOW,
    )
    expect(zone).toBe('dormant')
  })

  it('is MOVING on a recent PR', () => {
    const zone = exerciseZone(
      { lastPerformedAt: daysAgo(3), lastPrAt: daysAgo(3), trendDeltaKg: null },
      NOW,
    )
    expect(zone).toBe('moving')
  })

  it('is MOVING on a positive trend delta without a fresh running-max advance', () => {
    const zone = exerciseZone(
      { lastPerformedAt: daysAgo(3), lastPrAt: daysAgo(200), trendDeltaKg: 2.5 },
      NOW,
    )
    expect(zone).toBe('moving')
  })

  it('is TRAINING when active but flat or declining', () => {
    expect(
      exerciseZone({ lastPerformedAt: daysAgo(3), lastPrAt: null, trendDeltaKg: null }, NOW),
    ).toBe('training')
    expect(
      exerciseZone({ lastPerformedAt: daysAgo(3), lastPrAt: daysAgo(90), trendDeltaKg: -2 }, NOW),
    ).toBe('training')
  })
})

describe('status-line formatters', () => {
  it('formats the e1RM base unit-aware', () => {
    expect(e1rmStatusBase(142, 'kg')).toBe('142 kg e1RM')
    expect(e1rmStatusBase(100, 'lb')).toBe('221 lb e1RM') // 100 kg → 220.5 lb → rounds up
    expect(e1rmStatusBase(null, 'kg')).toBeNull()
  })

  it('formats the delta chip with direction, unit-aware', () => {
    expect(e1rmDeltaChip(2.5, 'kg')).toEqual({ text: '↑ +3 this month', direction: 'up' })
    expect(e1rmDeltaChip(-2.5, 'kg')).toEqual({ text: '↓ −3 this month', direction: 'down' })
    // 2.5 kg ≈ 5.5 lb → rounds to 6 in lb display.
    expect(e1rmDeltaChip(2.5, 'lb')).toEqual({ text: '↑ +6 this month', direction: 'up' })
  })

  it('suppresses the chip when there is no provable or visible delta', () => {
    expect(e1rmDeltaChip(null, 'kg')).toBeNull()
    expect(e1rmDeltaChip(0.2, 'kg')).toBeNull() // rounds to +0 — noise wearing an arrow
  })

  it('falls back to a session count line', () => {
    expect(sessionCountLine(1)).toBe('1 session')
    expect(sessionCountLine(8)).toBe('8 sessions')
  })
})

describe('recencyLabel', () => {
  it('speaks dates while fresh and relative words past the threshold', () => {
    expect(recencyLabel(daysAgo(0), NOW)).toBe('Today')
    expect(recencyLabel(daysAgo(1), NOW)).toBe('Yesterday')
    expect(recencyLabel(daysAgo(10), NOW)).toBe('Jul 10')
    expect(recencyLabel(daysAgo(35), NOW)).toBe('5 wks ago')
    expect(recencyLabel(daysAgo(120), NOW)).toBe('4 mo ago')
  })
})

describe('facet params (URL as state)', () => {
  it('parses valid values and degrades unknowns to defaults', () => {
    expect(parseLibraryParams({ muscle: 'Chest', sort: 'trained' })).toEqual({
      muscle: 'Chest',
      sort: 'trained',
    })
    expect(parseLibraryParams({ muscle: 'Forearms', sort: 'weird' })).toEqual({
      muscle: null,
      sort: 'recent',
    })
    expect(parseLibraryParams({})).toEqual({ muscle: null, sort: 'recent' })
  })

  it('takes the first value of a repeated param', () => {
    expect(parseLibraryParams({ muscle: ['Back', 'Chest'] })).toEqual({
      muscle: 'Back',
      sort: 'recent',
    })
  })

  it('builds hrefs that omit defaults', () => {
    expect(libraryHref({ muscle: null, sort: 'recent' })).toBe('/exercises')
    expect(libraryHref({ muscle: 'Chest', sort: 'recent' })).toBe('/exercises?muscle=Chest')
    expect(libraryHref({ muscle: 'Chest', sort: 'trained' })).toBe(
      '/exercises?muscle=Chest&sort=trained',
    )
    expect(libraryHref({ muscle: null, sort: 'trained' })).toBe('/exercises?sort=trained')
  })
})

describe('compareLibraryEntries', () => {
  const entry = (zone: 'moving' | 'training' | 'dormant', sessions: number, ms: number) => ({
    zone,
    sessionCount: sessions,
    lastPerformedAtMs: ms,
  })

  it('orders zones moving → training → dormant before anything else', () => {
    const rows = [entry('dormant', 99, 3), entry('training', 1, 2), entry('moving', 1, 1)]
    const sorted = [...rows].sort((a, b) => compareLibraryEntries(a, b, 'recent'))
    expect(sorted.map((r) => r.zone)).toEqual(['moving', 'training', 'dormant'])
  })

  it('sorts by recency within a zone by default and by sessions on trained', () => {
    const a = entry('training', 2, 100)
    const b = entry('training', 9, 50)
    expect([a, b].sort((x, y) => compareLibraryEntries(x, y, 'recent'))[0]).toBe(a)
    expect([a, b].sort((x, y) => compareLibraryEntries(x, y, 'trained'))[0]).toBe(b)
  })

  it('breaks trained ties on recency', () => {
    const a = entry('training', 5, 100)
    const b = entry('training', 5, 200)
    expect([a, b].sort((x, y) => compareLibraryEntries(x, y, 'trained'))[0]).toBe(b)
  })
})
