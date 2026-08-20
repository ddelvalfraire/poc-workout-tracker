import { describe, it, expect } from 'vitest'
import { catalogTranslator } from '../../vitest.intl'
import { scheduleAnchor, scheduleAnchorToken } from './schedule-anchor'

/**
 * The anchor is a VALUE, so these assert the kind — the thing callers branch
 * on. The words are a separate concern, checked once at the bottom through
 * the real catalog: that split is the whole point, because the branch must
 * survive translating the words.
 */
const word = (weekdays: number[], today: Date, namespace = 'StatusHero') => {
  const anchor = scheduleAnchor(weekdays, today)
  return anchor === null
    ? null
    : catalogTranslator(namespace)('anchor', { anchor: scheduleAnchorToken(anchor) })
}

// Local-time constructor (not ISO strings): scheduleAnchor reads getDay() in
// the runtime's zone, and these fixtures must mean the same weekday anywhere.
const WED = new Date(2026, 6, 29) // Wednesday (getDay 3)
const SAT = new Date(2026, 7, 1) // Saturday (getDay 6)
const SUN = new Date(2026, 7, 2) // Sunday (getDay 0)

describe('scheduleAnchor', () => {
  it('returns null for an unscheduled day (empty weekdays)', () => {
    expect(scheduleAnchor([], WED)).toBeNull()
  })

  it("returns the today kind when today's weekday is scheduled", () => {
    expect(scheduleAnchor([3], WED)).toEqual({ kind: 'today' })
    expect(scheduleAnchor([0], SUN)).toEqual({ kind: 'today' })
  })

  it('returns the tomorrow kind for the next calendar day, including the Sat→Sun wrap', () => {
    expect(scheduleAnchor([4], WED)).toEqual({ kind: 'tomorrow' })
    expect(scheduleAnchor([0], SAT)).toEqual({ kind: 'tomorrow' }) // wraps past Saturday
  })

  it('returns the weekday INDEX when the next slot is 2+ days out', () => {
    expect(scheduleAnchor([5], WED)).toEqual({ kind: 'weekday', weekday: 5 })
    expect(scheduleAnchor([1], WED)).toEqual({ kind: 'weekday', weekday: 1 }) // wraps into next week
    expect(scheduleAnchor([2], SUN)).toEqual({ kind: 'weekday', weekday: 2 })
  })

  it('picks the NEAREST of multiple scheduled weekdays', () => {
    // Wed vs [Mon, Fri]: Friday (2 days) beats Monday (5 days)
    expect(scheduleAnchor([1, 5], WED)).toEqual({ kind: 'weekday', weekday: 5 })
    // Wed vs [Wed, Fri]: today wins outright
    expect(scheduleAnchor([3, 5], WED)).toEqual({ kind: 'today' })
    // Sat vs [Mon, Sun]: Sunday is tomorrow
    expect(scheduleAnchor([0, 1], SAT)).toEqual({ kind: 'tomorrow' })
  })

  it('ignores out-of-range junk and returns null when nothing valid remains', () => {
    expect(scheduleAnchor([7, -1, 1.5], WED)).toBeNull()
    expect(scheduleAnchor([9, 3], WED)).toEqual({ kind: 'today' }) // junk dropped, 3 kept
  })

  it('never returns a display string a caller could branch on', () => {
    // The regression guard for the bug this shape exists to kill: home-status
    // used to compare the result against 'Today'.
    for (const weekdays of [[3], [4], [5], [1, 5]]) {
      expect(typeof scheduleAnchor(weekdays, WED)).toBe('object')
    }
  })
})

describe('scheduleAnchorToken', () => {
  it('names the day without saying it in any language', () => {
    expect(scheduleAnchorToken({ kind: 'today' })).toBe('today')
    expect(scheduleAnchorToken({ kind: 'tomorrow' })).toBe('tomorrow')
    expect(scheduleAnchorToken({ kind: 'weekday', weekday: 5 })).toBe('friday')
    expect(scheduleAnchorToken({ kind: 'weekday', weekday: 0 })).toBe('sunday')
  })

  it('renders through each surface\'s own copy of the words', () => {
    // The hero states them; the drawer lowercases them into its sub-line
    // voice — two catalogs, because a shared key could not do both.
    expect(word([3], WED)).toBe('Today')
    expect(word([4], WED)).toBe('Tomorrow')
    expect(word([5], WED)).toBe('Friday')
    expect(word([5], WED, 'NavDrawer')).toBe('friday')
    expect(word([3], WED, 'NavDrawer')).toBe('today')
    expect(word([], WED)).toBeNull()
  })

  it('leaves no token unresolved for any day of the week', () => {
    // The `other` arm echoes the raw token, so a weekday missing from a
    // surface's select would render 'wednesday' verbatim instead of the
    // surface's own word — this is what catches that.
    const TOKENS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    for (const namespace of ['StatusHero', 'UpNextAnchor']) {
      for (let weekday = 0; weekday < 7; weekday++) {
        const rendered = catalogTranslator(namespace)('anchor', {
          anchor: scheduleAnchorToken({ kind: 'weekday', weekday }),
        })
        // Every surface but the drawer states the day capitalized, so a
        // lowercase token echo is exactly the failure mode.
        expect(TOKENS, `${namespace} ${weekday}`).not.toContain(rendered)
      }
    }
  })
})
