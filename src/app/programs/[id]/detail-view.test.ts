import { describe, it, expect } from 'vitest'
import type { AutoregAdjustment } from '@/lib/autoregulate'
import {
  programStatusLine,
  parseExpandParam,
  withExpanded,
  withoutExpanded,
  shouldDeriveDay,
  collectAutoregNotes,
  groupEventsByDay,
} from './detail-view'

describe('programStatusLine', () => {
  const base = {
    currentWeek: 3,
    mesocycleWeeks: 7,
    deloadWeek: null,
    daysDoneThisWeek: 2,
    dayCountTotal: 4,
    blockComplete: false,
  }

  it('digests week position and remaining days', () => {
    expect(programStatusLine(base)).toBe('Week 3 of 7 · 2 days to go.')
  })

  it('singularizes one remaining day', () => {
    expect(programStatusLine({ ...base, daysDoneThisWeek: 3 })).toBe('Week 3 of 7 · 1 day to go.')
  })

  it('reads "week trained" when every day is done (and never goes negative)', () => {
    expect(programStatusLine({ ...base, daysDoneThisWeek: 4 })).toBe('Week 3 of 7 · week trained.')
    expect(programStatusLine({ ...base, daysDoneThisWeek: 9 })).toBe('Week 3 of 7 · week trained.')
  })

  it('announces a deload landing next week', () => {
    expect(programStatusLine({ ...base, deloadWeek: 4 })).toBe(
      'Week 3 of 7 · 2 days to go · deload next week.',
    )
  })

  it('names the current week as the deload when it is one', () => {
    expect(programStatusLine({ ...base, deloadWeek: 3 })).toBe(
      'Week 3 of 7 · deload week · 2 days to go.',
    )
  })

  it('collapses to the completion sentence when the block is complete', () => {
    expect(programStatusLine({ ...base, blockComplete: true })).toBe('Block complete.')
  })

  it('omits the day count for a dayless program', () => {
    expect(programStatusLine({ ...base, dayCountTotal: 0, daysDoneThisWeek: 0 })).toBe(
      'Week 3 of 7.',
    )
  })
})

describe('parseExpandParam', () => {
  it('returns an empty set when absent', () => {
    expect(parseExpandParam(undefined).size).toBe(0)
  })

  it('splits comma-separated ids and merges repeated params', () => {
    expect([...parseExpandParam('a,b')]).toEqual(['a', 'b'])
    expect([...parseExpandParam(['a', 'b,c'])]).toEqual(['a', 'b', 'c'])
  })

  it('drops blanks and trims whitespace', () => {
    expect([...parseExpandParam(' a , ,b,')]).toEqual(['a', 'b'])
    expect(parseExpandParam('').size).toBe(0)
  })

  it('dedupes repeated ids', () => {
    expect([...parseExpandParam('a,a')]).toEqual(['a'])
  })
})

describe('withExpanded / withoutExpanded', () => {
  it('adds a day id without duplicating', () => {
    expect(withExpanded(new Set(['a']), 'b')).toBe('a,b')
    expect(withExpanded(new Set(['a']), 'a')).toBe('a')
    expect(withExpanded(new Set(), 'a')).toBe('a')
  })

  it('removes a day id and signals param drop when empty', () => {
    expect(withoutExpanded(new Set(['a', 'b']), 'a')).toBe('b')
    expect(withoutExpanded(new Set(['a']), 'a')).toBeNull()
    expect(withoutExpanded(new Set(['a']), 'x')).toBe('a')
  })
})

describe('shouldDeriveDay', () => {
  it('derives the next-up day and expanded untouched days only', () => {
    expect(shouldDeriveDay(false, true, false)).toBe(true)
    expect(shouldDeriveDay(false, false, true)).toBe(true)
    expect(shouldDeriveDay(false, true, true)).toBe(true)
  })

  it('never derives resolved (done/in-progress) days', () => {
    expect(shouldDeriveDay(true, true, true)).toBe(false)
    expect(shouldDeriveDay(true, false, false)).toBe(false)
  })

  it('skips collapsed untouched days — the perf win', () => {
    expect(shouldDeriveDay(false, false, false)).toBe(false)
  })
})

const adjustment = (action: AutoregAdjustment['action']): AutoregAdjustment => ({
  action,
  deltaKg: action === 'decrement' ? -10 : 0,
  suggestEarlyDeload: false,
  stalledLoadBySetNumber: { 1: 100 },
  evidence: { missedSets: 2, scorableSets: 3, repFloor: 8, loadKg: 100 },
})

describe('collectAutoregNotes', () => {
  const days = [
    { exercises: [{ name: 'Bench' }, { name: 'Row' }] },
    { exercises: [{ name: 'Bench' }, { name: 'Squat' }] },
  ]

  it('collects repeat and decrement verdicts with their exercise names', () => {
    const notes = collectAutoregNotes(days, [
      [{ autoreg: adjustment('repeat') }, { autoreg: null }],
      [{ autoreg: null }, { autoreg: adjustment('decrement') }],
    ])
    expect(notes.map((n) => n.exerciseName)).toEqual(['Bench', 'Squat'])
    expect(notes[1].adjustment.action).toBe('decrement')
  })

  it('ignores progress verdicts (step/anchor)', () => {
    const notes = collectAutoregNotes(days, [
      [{ autoreg: adjustment('step') }, { autoreg: adjustment('anchor') }],
      [],
    ])
    expect(notes).toEqual([])
  })

  it('dedupes an exercise repeated across days', () => {
    const notes = collectAutoregNotes(days, [
      [{ autoreg: adjustment('repeat') }, { autoreg: null }],
      [{ autoreg: adjustment('repeat') }, { autoreg: null }],
    ])
    expect(notes).toHaveLength(1)
  })

  it('tolerates collapsed days with empty prescription arrays', () => {
    expect(collectAutoregNotes(days, [[], []])).toEqual([])
  })
})

describe('groupEventsByDay', () => {
  const day = (iso: string) => new Date(iso)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  it('buckets consecutive same-day events under one label, preserving order', () => {
    const events = [
      { id: 1, occurredAt: day('2026-07-02T18:00:00Z') },
      { id: 2, occurredAt: day('2026-07-02T09:00:00Z') },
      { id: 3, occurredAt: day('2026-07-01T12:00:00Z') },
    ]
    const groups = groupEventsByDay(events, fmt)
    expect(groups.map((g) => g.label)).toEqual(['2026-07-02', '2026-07-01'])
    expect(groups[0].events.map((e) => e.id)).toEqual([1, 2])
    expect(groups[1].events.map((e) => e.id)).toEqual([3])
  })

  it('handles an empty list', () => {
    expect(groupEventsByDay([], fmt)).toEqual([])
  })
})
