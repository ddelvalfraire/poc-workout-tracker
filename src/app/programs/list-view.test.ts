import { describe, it, expect } from 'vitest'
import { renderMessageIn } from '../../../vitest.intl'
import {
  programStatusLabel,
  proposalAgeLine,
  zonePrograms,
  buildThisWeekRows,
  blockSoFar,
} from './list-view'

/** The catalog half of a descriptor assertion: the key the view-model chose
 *  resolves, with its arguments, against the real en.json. */
const render = (message: Parameters<typeof renderMessageIn>[1]) =>
  renderMessageIn('Programs', message)

describe('programStatusLabel', () => {
  it('picks the catalog key for each known status', () => {
    expect(programStatusLabel('active')).toEqual({ key: 'status.active' })
    expect(programStatusLabel('proposed')).toEqual({ key: 'status.proposed' })
    expect(programStatusLabel('draft')).toEqual({ key: 'status.draft' })
    expect(programStatusLabel('archived')).toEqual({ key: 'status.archived' })
  })

  it('resolves those keys to the words the badge renders', () => {
    expect(render(programStatusLabel('active')!)).toBe('Active')
    expect(render(programStatusLabel('archived')!)).toBe('Archived')
  })

  it('has no copy for an unknown status, so the caller shows the raw value', () => {
    expect(programStatusLabel('paused')).toBeNull()
    expect(programStatusLabel('')).toBeNull()
  })
})

const p = (id: string, status: string) => ({ id, status })

describe('zonePrograms', () => {
  it('picks the first active as the hero (input is recency-ordered)', () => {
    const zones = zonePrograms([p('d1', 'draft'), p('a1', 'active'), p('a2', 'active')])
    expect(zones.hero).toEqual(p('a1', 'active'))
    expect(zones.otherActive).toEqual([p('a2', 'active')])
  })

  it('buckets proposed, drafts, and archived preserving order', () => {
    const zones = zonePrograms([
      p('x1', 'archived'),
      p('pr1', 'proposed'),
      p('d1', 'draft'),
      p('x2', 'archived'),
      p('pr2', 'proposed'),
    ])
    expect(zones.hero).toBeNull()
    expect(zones.proposed.map((z) => z.id)).toEqual(['pr1', 'pr2'])
    expect(zones.drafts.map((z) => z.id)).toEqual(['d1'])
    expect(zones.archived.map((z) => z.id)).toEqual(['x1', 'x2'])
  })

  it('routes unknown statuses to drafts rather than dropping them', () => {
    const zones = zonePrograms([p('m1', 'mystery')])
    expect(zones.drafts.map((z) => z.id)).toEqual(['m1'])
  })

  it('handles an empty list', () => {
    expect(zonePrograms([])).toEqual({
      hero: null,
      otherActive: [],
      proposed: [],
      drafts: [],
      archived: [],
    })
  })
})

describe('proposalAgeLine (staleness affordance)', () => {
  const NOW = new Date('2026-08-09T12:00:00Z')
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

  it('picks today / yesterday / a day count inside the first week', () => {
    expect(proposalAgeLine(NOW, NOW)).toEqual({ key: 'proposalAge.today' })
    expect(proposalAgeLine(daysAgo(1), NOW)).toEqual({ key: 'proposalAge.yesterday' })
    expect(proposalAgeLine(daysAgo(3), NOW)).toEqual({
      key: 'proposalAge.days',
      values: { days: 3 },
    })
    expect(proposalAgeLine(daysAgo(6), NOW)).toEqual({
      key: 'proposalAge.days',
      values: { days: 6 },
    })
  })

  it('rolls up to weeks and months for stale proposals — never expires', () => {
    expect(proposalAgeLine(daysAgo(7), NOW)).toEqual({
      key: 'proposalAge.weeks',
      values: { weeks: 1 },
    })
    expect(proposalAgeLine(daysAgo(20), NOW)).toEqual({
      key: 'proposalAge.weeks',
      values: { weeks: 2 },
    })
    expect(proposalAgeLine(daysAgo(30), NOW)).toEqual({
      key: 'proposalAge.months',
      values: { months: 1 },
    })
    expect(proposalAgeLine(daysAgo(365), NOW)).toEqual({
      key: 'proposalAge.months',
      values: { months: 12 },
    })
  })

  it('treats clock skew (future createdAt) as today', () => {
    expect(proposalAgeLine(daysAgo(-2), NOW)).toEqual({ key: 'proposalAge.today' })
  })

  // Each count asserted at ONE and at MANY separately: a single-branch plural
  // reads fine at one value and wrong at every other.
  it('agrees each rolled-up unit with its own count, through the catalog', () => {
    expect(render(proposalAgeLine(daysAgo(1), NOW))).toBe('proposed yesterday')
    expect(render(proposalAgeLine(daysAgo(2), NOW))).toBe('proposed 2 days ago')
    expect(render(proposalAgeLine(daysAgo(7), NOW))).toBe('proposed 1 week ago')
    expect(render(proposalAgeLine(daysAgo(14), NOW))).toBe('proposed 2 weeks ago')
    expect(render(proposalAgeLine(daysAgo(30), NOW))).toBe('proposed 1 month ago')
    expect(render(proposalAgeLine(daysAgo(60), NOW))).toBe('proposed 2 months ago')
  })

  it('leaves no unresolved key path', () => {
    for (const days of [0, 1, 3, 9, 40]) {
      expect(render(proposalAgeLine(daysAgo(days), NOW))).not.toMatch(
        /Programs\.[a-zA-Z.]+/,
      )
    }
  })
})

const day = (id: string) => ({ id })

const workout = (
  programDayId: string | null,
  programWeek: number | null,
  completed: boolean,
  startedAt = new Date('2026-08-01T10:00:00Z'),
  volumeKg = 0,
) => ({
  programDayId,
  programWeek,
  startedAt,
  completedAt: completed ? new Date(startedAt.getTime() + 3_600_000) : null,
  volumeKg,
})

describe('buildThisWeekRows (this-week band)', () => {
  it('marks a day done only for a completed workout in the CURRENT week', () => {
    const { rows, doneCount } = buildThisWeekRows(
      [day('a'), day('b'), day('c')],
      [
        workout('a', 2, true), // this week, done
        workout('b', 1, true), // last week — does not count
        workout('c', 2, false), // in progress — not done
      ],
      2,
      'b',
    )
    expect(rows.map((r) => r.state)).toEqual(['done', 'next', 'upcoming'])
    expect(doneCount).toBe(1)
  })

  it('lets a completed row beat a lingering in-progress duplicate (resolveDayState rule)', () => {
    const { rows } = buildThisWeekRows(
      [day('a')],
      [workout('a', 1, false), workout('a', 1, true)],
      1,
      null,
    )
    expect(rows[0].state).toBe('done')
  })

  it('is all-upcoming with no next day and no workouts', () => {
    const { rows, doneCount } = buildThisWeekRows([day('a'), day('b')], [], 1, null)
    expect(rows.map((r) => r.state)).toEqual(['upcoming', 'upcoming'])
    expect(doneCount).toBe(0)
  })

  it('never marks the next day done AND next at once — done wins', () => {
    const { rows } = buildThisWeekRows([day('a')], [workout('a', 3, true)], 3, 'a')
    expect(rows[0].state).toBe('done')
  })
})

describe('blockSoFar (block-so-far figures)', () => {
  it('counts distinct completed (day, week) pairs against days × weeks elapsed', () => {
    const stats = blockSoFar(
      3,
      [
        workout('a', 1, true, new Date('2026-08-01T10:00:00Z'), 1000),
        workout('a', 1, true, new Date('2026-08-01T12:00:00Z'), 500), // duplicate pair
        workout('b', 1, true, new Date('2026-08-02T10:00:00Z'), 2000),
        workout('a', 2, true, new Date('2026-08-08T10:00:00Z'), 1500),
        workout('c', 1, false), // in progress — not done
      ],
      2,
    )
    expect(stats.daysDone).toBe(3)
    expect(stats.daysPlanned).toBe(6)
  })

  it('sums volume over COMPLETED workouts only, all weeks', () => {
    const stats = blockSoFar(
      2,
      [
        workout('a', 1, true, new Date('2026-08-01T10:00:00Z'), 1000),
        workout('b', 1, false, new Date('2026-08-02T10:00:00Z'), 999), // abandoned
        workout('a', 2, true, new Date('2026-08-08T10:00:00Z'), 250),
      ],
      2,
    )
    expect(stats.volumeKg).toBe(1250)
  })

  it('ignores provenance-less rows for days-done but keeps their volume', () => {
    const stats = blockSoFar(2, [workout(null, null, true, new Date(), 300)], 1)
    expect(stats.daysDone).toBe(0)
    expect(stats.daysPlanned).toBe(2)
    expect(stats.volumeKg).toBe(300)
  })
})
