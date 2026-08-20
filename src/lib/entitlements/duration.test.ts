import { describe, expect, test } from 'vitest'
import { GRANT_DURATIONS, MIN_GRANT_REASON_LENGTH, endsAtFor, isGrantDuration } from './duration'

const FROM = new Date('2026-08-20T12:00:00.000Z')
const DAY = 86_400_000

describe('grant durations', () => {
  test('rejects anything outside the fixed set', () => {
    expect(isGrantDuration('30d')).toBe(true)
    expect(isGrantDuration('30 days')).toBe(false)
    expect(isGrantDuration('')).toBe(false)
  })

  test('every declared duration resolves to a date or to perpetual', () => {
    for (const duration of GRANT_DURATIONS) {
      const result = endsAtFor(duration, FROM)
      expect(duration === 'forever' ? result === null : result instanceof Date).toBe(true)
    }
  })

  test('measures each window from the moment the grant starts', () => {
    expect(endsAtFor('7d', FROM)!.getTime() - FROM.getTime()).toBe(7 * DAY)
    expect(endsAtFor('30d', FROM)!.getTime() - FROM.getTime()).toBe(30 * DAY)
    expect(endsAtFor('90d', FROM)!.getTime() - FROM.getTime()).toBe(90 * DAY)
    expect(endsAtFor('1y', FROM)!.getTime() - FROM.getTime()).toBe(365 * DAY)
  })

  // Perpetual has to be null rather than a far-future date: the projection
  // treats null as "never check the clock", and a sentinel year would silently
  // expire somebody's lifetime purchase.
  test('perpetual is null, not a distant date', () => {
    expect(endsAtFor('forever', FROM)).toBeNull()
  })

  test('every window is strictly after the start, which the schema requires', () => {
    for (const duration of GRANT_DURATIONS) {
      const end = endsAtFor(duration, FROM)
      if (end) expect(end.getTime()).toBeGreaterThan(FROM.getTime())
    }
  })
})

describe('the shared reason floor', () => {
  // Form and action both validate against this. Two independent literals drift,
  // and the drift shows as a form that submits and an action that rejects.
  test('is a positive length both sides can agree on', () => {
    expect(MIN_GRANT_REASON_LENGTH).toBeGreaterThan(0)
  })
})
