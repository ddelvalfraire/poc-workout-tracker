import { describe, it, expect } from 'vitest'
import { stickyNote, noteChipLabel } from './identity-note'

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
