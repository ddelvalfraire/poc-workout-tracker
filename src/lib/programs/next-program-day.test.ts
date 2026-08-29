import { describe, it, expect } from 'vitest'
import { pickNextProgramDay } from './next-program-day'

const day = (id: string, position: number) => ({ id, position })

describe('pickNextProgramDay', () => {
  it('returns null when the program has no days', () => {
    expect(pickNextProgramDay([], new Set())).toBeNull()
  })

  it('returns the lowest-position day when nothing is logged this week', () => {
    const days = [day('b', 1), day('a', 0), day('c', 2)]

    expect(pickNextProgramDay(days, new Set())?.id).toBe('a')
  })

  it('skips days already logged at the current week', () => {
    const days = [day('a', 0), day('b', 1), day('c', 2)]

    expect(pickNextProgramDay(days, new Set(['a']))?.id).toBe('b')
    expect(pickNextProgramDay(days, new Set(['a', 'b']))?.id).toBe('c')
  })

  it('rotates forward: the day after the last-trained day comes before earlier skipped ones', () => {
    const days = [day('a', 0), day('b', 1), day('c', 2)]

    expect(pickNextProgramDay(days, new Set(['b']))?.id).toBe('c')
  })

  it('wraps to the earliest unlogged day once past the last position', () => {
    const days = [day('a', 0), day('b', 1), day('c', 2)]

    expect(pickNextProgramDay(days, new Set(['c']))?.id).toBe('a')
    expect(pickNextProgramDay(days, new Set(['b', 'c']))?.id).toBe('a')
  })

  it('skips logged days when wrapping to make up earlier gaps', () => {
    const days = [day('a', 0), day('b', 1), day('c', 2)]

    expect(pickNextProgramDay(days, new Set(['a', 'c']))?.id).toBe('b')
  })

  it('wraps to the first day when every day is logged (finished cycle re-runs)', () => {
    const days = [day('b', 1), day('a', 0)]

    expect(pickNextProgramDay(days, new Set(['a', 'b']))?.id).toBe('a')
  })

  it('does not mutate the input array', () => {
    const days = [day('b', 1), day('a', 0)]

    pickNextProgramDay(days, new Set())

    expect(days.map((d) => d.id)).toEqual(['b', 'a'])
  })
})
