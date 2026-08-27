import { describe, it, expect } from 'vitest'
import { AMENDMENT_KINDS, type WorkoutEventKind } from '@/db/workout-events'
import {
  amendedMark,
  daysBetween,
  isAmendmentKind,
  type WorkoutChangelogEntry,
} from './workout-changelog-view'

const ALL_KINDS: readonly WorkoutEventKind[] = ['original', 'late_entry', 'amendment', 'system']

function entry(overrides: Partial<WorkoutChangelogEntry> = {}): WorkoutChangelogEntry {
  return {
    id: 'e1',
    kind: 'amendment',
    actor: 'ui',
    occurredAt: new Date('2026-01-15T09:00:00Z'),
    summary: 'Set 3 of Squat — weight 100 → 102.5',
    ...overrides,
  }
}

describe('isAmendmentKind', () => {
  /**
   * The db layer names this filter once (AMENDMENT_KINDS) and the browser
   * cannot import that module. This is the seam where the two would drift
   * silently — a kind added to one and not the other would quietly change
   * what the default view hides.
   */
  it('agrees with the db layer on every event kind', () => {
    for (const kind of ALL_KINDS) {
      expect(isAmendmentKind(kind), kind).toBe(AMENDMENT_KINDS.includes(kind))
    }
  })
})

describe('daysBetween', () => {
  it('floors to whole elapsed days', () => {
    const from = new Date('2026-01-01T00:00:00Z')
    expect(daysBetween(from, new Date('2026-01-01T23:59:00Z'))).toBe(0)
    expect(daysBetween(from, new Date('2026-01-02T00:00:00Z'))).toBe(1)
    expect(daysBetween(from, new Date('2026-01-03T12:00:00Z'))).toBe(2)
  })

  it('never goes negative', () => {
    // An event stamped before the session (clock skew, a backdated import)
    // must not render as "-1 days after the session".
    expect(daysBetween(new Date('2026-01-05T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toBe(0)
  })
})

describe('amendedMark', () => {
  const sessionAt = new Date('2026-01-10T18:00:00Z')

  it('is null when nothing contradicts the record', () => {
    // Arrange — a full stream with no amendment in it
    const entries = [
      entry({ id: 'a', kind: 'original' }),
      entry({ id: 'b', kind: 'late_entry' }),
      entry({ id: 'c', kind: 'system' }),
    ]

    // Act + Assert — the surface is absent, not empty
    expect(amendedMark(entries, sessionAt)).toBeNull()
  })

  it('counts only amendments and measures to the most recent one', () => {
    // Arrange — newest first, as the read path returns them
    const entries = [
      entry({ id: 'a', kind: 'amendment', occurredAt: new Date('2026-01-12T18:00:00Z') }),
      entry({ id: 'b', kind: 'system', occurredAt: new Date('2026-01-12T09:00:00Z') }),
      entry({ id: 'c', kind: 'amendment', occurredAt: new Date('2026-01-11T18:00:00Z') }),
      entry({ id: 'd', kind: 'original', occurredAt: sessionAt }),
    ]

    // Act
    const mark = amendedMark(entries, sessionAt)

    // Assert — two edits, the latest two days after the session
    expect(mark).toEqual({ count: 2, days: 2 })
  })

  it('reports a same-day correction as zero days', () => {
    const entries = [entry({ occurredAt: new Date('2026-01-10T21:00:00Z') })]
    expect(amendedMark(entries, sessionAt)).toEqual({ count: 1, days: 0 })
  })
})
