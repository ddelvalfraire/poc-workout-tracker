import { describe, it, expect } from 'vitest'
import { checkInCardDetail, checkInDismissKey, shouldShowCheckInCard } from './check-in-card'

describe('shouldShowCheckInCard', () => {
  it('shows only when due and not dismissed today', () => {
    expect(shouldShowCheckInCard(true, false)).toBe(true)
    expect(shouldShowCheckInCard(true, true)).toBe(false)
    expect(shouldShowCheckInCard(false, false)).toBe(false)
    expect(shouldShowCheckInCard(false, true)).toBe(false)
  })
})

describe('checkInDismissKey', () => {
  it('keys by the LOCAL calendar day, zero-padded', () => {
    // Local-time constructor on purpose: the dismissal day is the user's day.
    expect(checkInDismissKey(new Date(2026, 6, 31))).toBe('checkin-card-dismissed:2026-07-31')
    expect(checkInDismissKey(new Date(2026, 0, 5))).toBe('checkin-card-dismissed:2026-01-05')
  })

  it('mints a different key on the next local day (dismissal expires)', () => {
    expect(checkInDismissKey(new Date(2026, 6, 31, 23, 59))).not.toBe(
      checkInDismissKey(new Date(2026, 7, 1, 0, 1)),
    )
  })
})

describe('checkInCardDetail', () => {
  it('covers never / today / yesterday / N days ago', () => {
    expect(checkInCardDetail(null)).toBe('first one for this program')
    expect(checkInCardDetail(0)).toBe('last was today')
    expect(checkInCardDetail(1)).toBe('last was yesterday')
    expect(checkInCardDetail(16)).toBe('last was 16 days ago')
  })
})
