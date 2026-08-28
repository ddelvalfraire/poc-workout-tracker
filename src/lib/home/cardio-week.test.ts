import { describe, it, expect } from 'vitest'
import { cardioWeek } from './cardio-week'

describe('cardioWeek', () => {
  it('reports whole minutes for the current window', () => {
    expect(cardioWeek(96 * 60, 0)).toEqual({ minutes: 96, deltaMinutes: null })
  })

  it('compares against the previous window when there is one', () => {
    expect(cardioWeek(96 * 60, 74 * 60)).toEqual({ minutes: 96, deltaMinutes: 22 })
  })

  it('reports a decline as a negative delta', () => {
    expect(cardioWeek(40 * 60, 65 * 60)).toEqual({ minutes: 40, deltaMinutes: -25 })
  })

  it('refuses a hollow comparison against an empty previous window', () => {
    // "+96 vs last week" against nothing is the same number wearing a plus
    // sign, not a comparison.
    expect(cardioWeek(96 * 60, 0)?.deltaMinutes).toBeNull()
  })

  it('renders nothing when the week holds no cardio', () => {
    expect(cardioWeek(0, 0)).toBeNull()
    expect(cardioWeek(0, 3600)).toBeNull()
  })

  it('treats a sub-30-second total as no cardio rather than a zero headline', () => {
    expect(cardioWeek(29, 0)).toBeNull()
    expect(cardioWeek(31, 0)).toEqual({ minutes: 1, deltaMinutes: null })
  })

  it('rounds once, so the headline and the delta can never disagree', () => {
    // 95.6 -> 96 and 95.1 -> 95. Deriving the delta from raw seconds would
    // round 30s to "+1"; rounding both first gives the honest +1 against the
    // numbers actually shown.
    const week = cardioWeek(95.6 * 60, 95.1 * 60)
    expect(week).toEqual({ minutes: 96, deltaMinutes: 1 })
    expect(week!.minutes - 95).toBe(week!.deltaMinutes)
  })

  it('shows no delta when both windows round to the same minute', () => {
    expect(cardioWeek(60 * 60, 60 * 60)?.deltaMinutes).toBe(0)
  })
})
