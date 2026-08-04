import { describe, it, expect } from 'vitest'
import { programStatusLabel, zonePrograms } from './list-view'

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
