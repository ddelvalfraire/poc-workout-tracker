import { describe, it, expect } from 'vitest'
import { inWindow, volumeWindows } from './volume-window'

const DAY_MS = 24 * 60 * 60 * 1000

describe('volumeWindows — rolling', () => {
  it('splits the trailing 14 days into two adjacent 7-day windows ending now', () => {
    const now = new Date('2026-07-15T18:30:00Z')

    const w = volumeWindows('rolling', now)

    expect(w.current.end).toEqual(now)
    expect(w.current.start).toEqual(new Date('2026-07-08T18:30:00Z'))
    expect(w.previous.end).toEqual(w.current.start)
    expect(w.previous.start).toEqual(new Date('2026-07-01T18:30:00Z'))
  })
})

describe('volumeWindows — calendar', () => {
  it('starts the week on local Monday midnight (UTC client)', () => {
    // 2026-07-15 is a Wednesday.
    const now = new Date('2026-07-15T18:30:00Z')

    const w = volumeWindows('calendar', now, 0)

    expect(w.current.start).toEqual(new Date('2026-07-13T00:00:00Z')) // Monday
    expect(w.current.end).toEqual(new Date('2026-07-20T00:00:00Z'))
    expect(w.previous.start).toEqual(new Date('2026-07-06T00:00:00Z'))
  })

  it('shifts the boundary by the client tz offset (UTC-5: offset +300)', () => {
    const now = new Date('2026-07-15T18:30:00Z')

    const w = volumeWindows('calendar', now, 300)

    // Local Monday 00:00 in UTC-5 is 05:00 UTC.
    expect(w.current.start).toEqual(new Date('2026-07-13T05:00:00Z'))
  })

  it('handles a UTC instant that is already the next local day (UTC+1: offset −60)', () => {
    // 23:30 UTC on Sunday the 19th is 00:30 Monday the 20th in UTC+1 —
    // the local week has already rolled over.
    const now = new Date('2026-07-19T23:30:00Z')

    const w = volumeWindows('calendar', now, -60)

    // Local Monday 00:00 (Jul 20) in UTC+1 is 23:00 UTC on Jul 19.
    expect(w.current.start).toEqual(new Date('2026-07-19T23:00:00Z'))
  })
})

describe('inWindow', () => {
  const win = { start: new Date('2026-07-13T00:00:00Z'), end: new Date('2026-07-20T00:00:00Z') }

  it('is start-inclusive and end-exclusive', () => {
    expect(inWindow(win.start, win)).toBe(true)
    expect(inWindow(win.end, win)).toBe(false)
    expect(inWindow(new Date(win.end.getTime() - 1), win)).toBe(true)
    expect(inWindow(new Date(win.start.getTime() - DAY_MS), win)).toBe(false)
  })
})
