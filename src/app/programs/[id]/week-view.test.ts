import { describe, it, expect } from 'vitest'
import { parseWeekParam, resolveDayState } from './week-view'

describe('parseWeekParam', () => {
  it('returns the current week when the param is absent', () => {
    expect(parseWeekParam(undefined, 3, 8)).toBe(3)
  })

  it('parses a plain numeric week', () => {
    expect(parseWeekParam('5', 3, 8)).toBe(5)
  })

  it('takes the first value of a repeated param', () => {
    expect(parseWeekParam(['2', '7'], 3, 8)).toBe(2)
  })

  it('falls back to the current week on non-numeric input', () => {
    expect(parseWeekParam('banana', 3, 8)).toBe(3)
    expect(parseWeekParam('', 3, 8)).toBe(3)
  })

  it('clamps below-range and above-range weeks into 1..mesocycleWeeks', () => {
    expect(parseWeekParam('0', 3, 8)).toBe(1)
    expect(parseWeekParam('-4', 3, 8)).toBe(1)
    expect(parseWeekParam('99', 3, 8)).toBe(8)
  })

  it('truncates fractional weeks (parseInt semantics)', () => {
    expect(parseWeekParam('2.9', 3, 8)).toBe(2)
  })
})

const at = (iso: string) => new Date(iso)
const row = (startedAt: string, completedAt: string | null, id = startedAt) => ({
  id,
  startedAt: at(startedAt),
  completedAt: completedAt === null ? null : at(completedAt),
})

describe('resolveDayState', () => {
  it('returns null when the day has no workouts for the week', () => {
    expect(resolveDayState([])).toBeNull()
  })

  it('reports a completed workout as completed', () => {
    const done = row('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z')
    expect(resolveDayState([done])).toEqual({ state: 'completed', workout: done })
  })

  it('reports an unfinished workout as in-progress', () => {
    const live = row('2026-07-01T10:00:00Z', null)
    expect(resolveDayState([live])).toEqual({ state: 'in-progress', workout: live })
  })

  it('lets completed beat in-progress even when the in-progress row is fresher', () => {
    const done = row('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z', 'done')
    const abandoned = row('2026-07-02T10:00:00Z', null, 'abandoned')
    expect(resolveDayState([abandoned, done])).toEqual({ state: 'completed', workout: done })
  })

  it('picks the freshest row within a state regardless of input order', () => {
    const older = row('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z', 'older')
    const newer = row('2026-07-03T10:00:00Z', '2026-07-03T11:00:00Z', 'newer')
    expect(resolveDayState([older, newer])).toEqual({ state: 'completed', workout: newer })
    expect(resolveDayState([newer, older])).toEqual({ state: 'completed', workout: newer })
  })
})
