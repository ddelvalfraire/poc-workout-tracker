import { describe, it, expect } from 'vitest'
import { renderMessageIn } from '../../../vitest.intl'
import { programStatusLabel, proposalAgeLine, zonePrograms } from './list-view'

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
