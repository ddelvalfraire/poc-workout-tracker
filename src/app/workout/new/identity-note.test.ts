import { describe, it, expect } from 'vitest'
import { stickyNote, noteChipLabel, lastSessionEcho } from './identity-note'

describe('stickyNote (chip show rule)', () => {
  const pinned = { body: 'Seat pin 4', pinned: true }
  const unpinned = { body: 'Seat pin 4', pinned: false }

  it('shows the history note only when pinned', () => {
    expect(stickyNote(undefined, pinned)).toEqual(pinned)
    expect(stickyNote(undefined, unpinned)).toBeNull()
    expect(stickyNote(undefined, null)).toBeNull()
    expect(stickyNote(undefined, undefined)).toBeNull()
  })

  it('a session-local edit overrides history', () => {
    const edited = { body: 'Pin 5 now', pinned: true }
    expect(stickyNote(edited, pinned)).toEqual(edited)
    // Unpinning mid-session hides the chip even though history still pins.
    expect(stickyNote(unpinned, pinned)).toBeNull()
  })

  it('a session-local delete (null) beats a pinned history note', () => {
    expect(stickyNote(null, pinned)).toBeNull()
  })
})

describe('noteChipLabel', () => {
  it('takes the first non-empty line, stripped of markdown tokens', () => {
    expect(noteChipLabel('**Seat pin 4** at *45°*\n\nMore detail')).toBe('Seat pin 4 at 45°')
    expect(noteChipLabel('\n- pin 4')).toBe('pin 4')
    expect(noteChipLabel('## Setup')).toBe('Setup')
    expect(noteChipLabel('1. warm up')).toBe('warm up')
    expect(noteChipLabel('[video](https://e.co/v)')).toBe('video')
  })

  it('caps the label with an ellipsis', () => {
    const long = 'x'.repeat(120)
    const label = noteChipLabel(long)
    expect(label.length).toBe(80)
    expect(label.endsWith('…')).toBe(true)
  })
})

describe('lastSessionEcho (the middle tier show rule)', () => {
  it('echoes a previous-session note when this session has none', () => {
    expect(lastSessionEcho('Felt strong, add 2.5', '', null)).toEqual({
      text: 'Felt strong, add 2.5',
      sessionSkipped: false,
    })
  })

  it('trims the echoed note', () => {
    expect(lastSessionEcho('  slow eccentric \n', '', null)).toEqual({
      text: 'slow eccentric',
      sessionSkipped: false,
    })
  })

  it('never echoes when there is no previous note', () => {
    expect(lastSessionEcho(null, '', null)).toBeNull()
    expect(lastSessionEcho(undefined, '', null)).toBeNull()
    expect(lastSessionEcho('   ', '', null)).toBeNull()
  })

  it('disappears once a session note exists', () => {
    expect(lastSessionEcho('Felt strong', 'new note', null)).toBeNull()
    // Whitespace-only input is not a note yet — the echo stays offered.
    expect(lastSessionEcho('Felt strong', '  ', null)).toEqual({
      text: 'Felt strong',
      sessionSkipped: false,
    })
  })

  it('suppressed when the pinned chip already shows the same text', () => {
    expect(lastSessionEcho('Seat pin 4', '', { body: 'Seat pin 4', pinned: true })).toBeNull()
    expect(lastSessionEcho('Seat pin 4 ', '', { body: ' Seat pin 4\n', pinned: true })).toBeNull()
    // A different pinned note does not block the echo.
    expect(lastSessionEcho('Felt strong', '', { body: 'Seat pin 4', pinned: true })).toEqual({
      text: 'Felt strong',
      sessionSkipped: false,
    })
  })

  it('passes the skipped-session flag through (the label rides the fact, never re-derives it)', () => {
    expect(lastSessionEcho('shoulder tweak', '', null, true)).toEqual({
      text: 'shoulder tweak',
      sessionSkipped: true,
    })
    // Omitted = a performed session (pre-flag callers keep their meaning).
    expect(lastSessionEcho('shoulder tweak', '', null)).toEqual({
      text: 'shoulder tweak',
      sessionSkipped: false,
    })
  })

  it('the flag never changes eligibility — a skipped session with no note is still no echo', () => {
    expect(lastSessionEcho(null, '', null, true)).toBeNull()
    expect(lastSessionEcho('Seat pin 4', '', { body: 'Seat pin 4', pinned: true }, true)).toBeNull()
    expect(lastSessionEcho('Felt strong', 'new note', null, true)).toBeNull()
  })
})
