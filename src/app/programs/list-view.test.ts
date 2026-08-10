import { describe, it, expect } from 'vitest'
import { programStatusLabel, proposalAgeLine, zonePrograms } from './list-view'

describe('programStatusLabel', () => {
  it('labels the known statuses', () => {
    expect(programStatusLabel('active')).toBe('Active')
    expect(programStatusLabel('proposed')).toBe('Proposed')
    expect(programStatusLabel('draft')).toBe('Draft')
    expect(programStatusLabel('archived')).toBe('Archived')
  })

  it('title-cases unknown statuses instead of leaking raw values', () => {
    expect(programStatusLabel('paused')).toBe('Paused')
    expect(programStatusLabel('')).toBe('')
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

  it('reads today / yesterday / N days ago inside the first week', () => {
    expect(proposalAgeLine(NOW, NOW)).toBe('proposed today')
    expect(proposalAgeLine(daysAgo(1), NOW)).toBe('proposed yesterday')
    expect(proposalAgeLine(daysAgo(3), NOW)).toBe('proposed 3 days ago')
    expect(proposalAgeLine(daysAgo(6), NOW)).toBe('proposed 6 days ago')
  })

  it('rolls up to weeks and months for stale proposals — never expires', () => {
    expect(proposalAgeLine(daysAgo(7), NOW)).toBe('proposed 1 week ago')
    expect(proposalAgeLine(daysAgo(20), NOW)).toBe('proposed 2 weeks ago')
    expect(proposalAgeLine(daysAgo(30), NOW)).toBe('proposed 1 month ago')
    expect(proposalAgeLine(daysAgo(365), NOW)).toBe('proposed 12 months ago')
  })

  it('treats clock skew (future createdAt) as today', () => {
    expect(proposalAgeLine(daysAgo(-2), NOW)).toBe('proposed today')
  })
})
