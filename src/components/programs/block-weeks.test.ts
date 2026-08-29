import { describe, it, expect } from 'vitest'
import { buildBlockWeeks, blockWeeksFromStats, segmentFillPct } from './block-weeks'

const done = (programDayId: string, programWeek: number) => ({
  programDayId,
  programWeek,
  completedAt: new Date('2026-07-01T10:00:00Z'),
})

const base = { mesocycleWeeks: 4, deloadWeek: null, currentWeek: 1, dayCountTotal: 3 }

describe('buildBlockWeeks', () => {
  it('spans 1..mesocycleWeeks with zero counts for an unstarted program', () => {
    const weeks = buildBlockWeeks({ ...base, workouts: [] })
    expect(weeks.map((w) => w.week)).toEqual([1, 2, 3, 4])
    expect(weeks.every((w) => w.dayCountDone === 0 && w.dayCountTotal === 3)).toBe(true)
    expect(weeks[0].isCurrent).toBe(true)
    expect(weeks.slice(1).every((w) => !w.isCurrent)).toBe(true)
  })

  it('counts distinct completed days per week', () => {
    const weeks = buildBlockWeeks({
      ...base,
      currentWeek: 2,
      workouts: [done('a', 1), done('b', 1), done('a', 2)],
    })
    expect(weeks[0].dayCountDone).toBe(2)
    expect(weeks[1].dayCountDone).toBe(1)
    expect(weeks[1].isCurrent).toBe(true)
  })

  it('deduplicates historical duplicate rows for one (day, week)', () => {
    const weeks = buildBlockWeeks({ ...base, workouts: [done('a', 1), done('a', 1)] })
    expect(weeks[0].dayCountDone).toBe(1)
  })

  it('ignores incomplete workouts and rows missing provenance', () => {
    const weeks = buildBlockWeeks({
      ...base,
      workouts: [
        { programDayId: 'a', programWeek: 1, completedAt: null },
        { programDayId: null, programWeek: 1, completedAt: new Date() },
        { programDayId: 'a', programWeek: null, completedAt: new Date() },
      ],
    })
    expect(weeks[0].dayCountDone).toBe(0)
  })

  it('flags the deload week', () => {
    const weeks = buildBlockWeeks({ ...base, deloadWeek: 3, workouts: [] })
    expect(weeks.map((w) => w.isDeload)).toEqual([false, false, true, false])
  })

  it('keeps overflow weeks beyond the mesocycle when history overshoots', () => {
    const weeks = buildBlockWeeks({ ...base, workouts: [done('a', 6)] })
    expect(weeks).toHaveLength(6)
    expect(weeks[5]).toMatchObject({ week: 6, dayCountDone: 1 })
  })

  it('extends to the current week even without workouts there', () => {
    const weeks = buildBlockWeeks({ ...base, mesocycleWeeks: 2, currentWeek: 5, workouts: [] })
    expect(weeks).toHaveLength(5)
  })

  it('renders at least one week for a degenerate zero-week program', () => {
    const weeks = buildBlockWeeks({ ...base, mesocycleWeeks: 0, currentWeek: 0, workouts: [] })
    expect(weeks).toHaveLength(1)
    expect(weeks[0].week).toBe(1)
  })
})

describe('blockWeeksFromStats', () => {
  it('maps stats rows onto the shared shape', () => {
    const weeks = blockWeeksFromStats(
      [
        { week: 1, daysCompleted: 2, plannedDays: 3 },
        { week: 2, daysCompleted: 0, plannedDays: 3 },
      ],
      2,
      2,
    )
    expect(weeks[0]).toEqual({
      week: 1,
      dayCountDone: 2,
      dayCountTotal: 3,
      isDeload: false,
      isCurrent: false,
    })
    expect(weeks[1]).toMatchObject({ isDeload: true, isCurrent: true })
  })
})

describe('segmentFillPct', () => {
  it('rounds the completed fraction to a whole percent', () => {
    expect(segmentFillPct(2, 4)).toBe(50)
    expect(segmentFillPct(1, 3)).toBe(33)
  })

  it('clamps overcounts to 100 and never divides by zero', () => {
    expect(segmentFillPct(5, 3)).toBe(100)
    expect(segmentFillPct(1, 0)).toBe(0)
    expect(segmentFillPct(0, 0)).toBe(0)
  })

  it('never goes negative', () => {
    expect(segmentFillPct(-1, 3)).toBe(0)
  })
})
