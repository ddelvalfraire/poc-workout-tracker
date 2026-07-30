import { describe, it, expect } from 'vitest'
import { scheduleAnchor } from './schedule-anchor'

// Local-time constructor (not ISO strings): scheduleAnchor reads getDay() in
// the runtime's zone, and these fixtures must mean the same weekday anywhere.
const WED = new Date(2026, 6, 29) // Wednesday (getDay 3)
const SAT = new Date(2026, 7, 1) // Saturday (getDay 6)
const SUN = new Date(2026, 7, 2) // Sunday (getDay 0)

describe('scheduleAnchor', () => {
  it('returns null for an unscheduled day (empty weekdays)', () => {
    expect(scheduleAnchor([], WED)).toBeNull()
  })

  it("returns 'Today' when today's weekday is scheduled", () => {
    expect(scheduleAnchor([3], WED)).toBe('Today')
    expect(scheduleAnchor([0], SUN)).toBe('Today')
  })

  it("returns 'Tomorrow' for the next calendar day, including the Sat→Sun wrap", () => {
    expect(scheduleAnchor([4], WED)).toBe('Tomorrow')
    expect(scheduleAnchor([0], SAT)).toBe('Tomorrow') // wraps past Saturday
  })

  it('returns the weekday name when the next slot is 2+ days out', () => {
    expect(scheduleAnchor([5], WED)).toBe('Friday')
    expect(scheduleAnchor([1], WED)).toBe('Monday') // wrap-around into next week
    expect(scheduleAnchor([2], SUN)).toBe('Tuesday')
  })

  it('picks the NEAREST of multiple scheduled weekdays', () => {
    // Wed vs [Mon, Fri]: Friday (2 days) beats Monday (5 days)
    expect(scheduleAnchor([1, 5], WED)).toBe('Friday')
    // Wed vs [Wed, Fri]: today wins outright
    expect(scheduleAnchor([3, 5], WED)).toBe('Today')
    // Sat vs [Mon, Sun]: Sunday is tomorrow
    expect(scheduleAnchor([0, 1], SAT)).toBe('Tomorrow')
  })

  it('ignores out-of-range junk and returns null when nothing valid remains', () => {
    expect(scheduleAnchor([7, -1, 1.5], WED)).toBeNull()
    expect(scheduleAnchor([9, 3], WED)).toBe('Today') // junk dropped, 3 kept
  })
})
