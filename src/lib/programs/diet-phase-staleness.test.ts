import { describe, it, expect } from 'vitest'
import { CUT_STALE_WEEKS, cuttingStalenessWeeks } from './diet-phase-staleness'

const now = new Date(2026, 7, 10, 12, 0, 0)
const weeksAgo = (w: number) => new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000)

describe('cuttingStalenessWeeks', () => {
  it('asks after CUT_STALE_WEEKS whole weeks of cutting', () => {
    expect(cuttingStalenessWeeks('cutting', weeksAgo(CUT_STALE_WEEKS), now)).toBe(CUT_STALE_WEEKS)
    expect(cuttingStalenessWeeks('cutting', weeksAgo(11), now)).toBe(11)
  })

  it('stays silent while the cut is fresh (the common case never nags)', () => {
    expect(cuttingStalenessWeeks('cutting', weeksAgo(CUT_STALE_WEEKS - 1), now)).toBeNull()
    expect(cuttingStalenessWeeks('cutting', now, now)).toBeNull()
  })

  it('only cutting goes stale — maintenance is indefinite, long bulks are ordinary', () => {
    expect(cuttingStalenessWeeks('maintaining', weeksAgo(30), now)).toBeNull()
    expect(cuttingStalenessWeeks('bulking', weeksAgo(30), now)).toBeNull()
    expect(cuttingStalenessWeeks(null, weeksAgo(30), now)).toBeNull()
  })

  it('stays silent without an anchor (pre-column rows) — no honest clock, no accusation', () => {
    expect(cuttingStalenessWeeks('cutting', null, now)).toBeNull()
  })
})
