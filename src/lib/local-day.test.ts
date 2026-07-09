import { describe, it, expect } from 'vitest'
import { isSameLocalDay } from './local-day'

// All fixtures constructed with the LOCAL-time Date constructor on purpose:
// this helper answers "same calendar day in the runtime's timezone?", so the
// tests must not depend on what UTC offset the test machine happens to have.
describe('isSameLocalDay', () => {
  it('is true for two times on the same local day', () => {
    const morning = new Date(2026, 6, 8, 6, 30) // Jul 8, 06:30 local
    const night = new Date(2026, 6, 8, 23, 59)

    expect(isSameLocalDay(morning, night)).toBe(true)
  })

  it('is false across a local midnight (yesterday evening vs this morning)', () => {
    // The exact bug this helper fixes: a 9pm completion must not count as
    // "trained today" at 7am the next morning, even though only 10h passed.
    const lastNight = new Date(2026, 6, 7, 21, 0)
    const thisMorning = new Date(2026, 6, 8, 7, 0)

    expect(isSameLocalDay(lastNight, thisMorning)).toBe(false)
  })

  it('is false across a month boundary even for the same day-of-month distance', () => {
    const june30 = new Date(2026, 5, 30, 12, 0)
    const july1 = new Date(2026, 6, 1, 12, 0)

    expect(isSameLocalDay(june30, july1)).toBe(false)
  })

  it('is false for the same month/date in a different year', () => {
    // date+month equality alone would wrongly match Jul 8 2025 vs Jul 8 2026.
    const lastYear = new Date(2025, 6, 8, 12, 0)
    const thisYear = new Date(2026, 6, 8, 12, 0)

    expect(isSameLocalDay(lastYear, thisYear)).toBe(false)
  })

  it('is symmetric', () => {
    const a = new Date(2026, 6, 7, 23, 59)
    const b = new Date(2026, 6, 8, 0, 0)

    expect(isSameLocalDay(a, b)).toBe(false)
    expect(isSameLocalDay(b, a)).toBe(false)
  })
})
