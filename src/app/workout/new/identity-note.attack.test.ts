import { describe, it, expect } from 'vitest'
import { stickyNote, noteChipLabel, lastSessionEcho } from './identity-note'

/**
 * ADVERSARIAL VERIFICATION (#211) — pure-function attacks on the echo
 * eligibility matrix, specifically the interaction between the 80-char /
 * markdown-stripping chip label and the "identical to pinned" suppression.
 *
 * Spec claims under attack (PR #235 / direction doc § #211):
 * - "The echo never duplicates the pinned chip: identical text is suppressed"
 *   / "one surface per fact".
 * - The suppression must be judged against WHAT THE USER SEES: both the
 *   pinned chip and the echo line render through noteChipLabel (first line,
 *   markdown stripped, 80-char cap), while lastSessionEcho compares the RAW
 *   trimmed bodies. Any pair of notes that differ raw but collapse to the
 *   same label puts the same words on screen twice.
 */

describe('ATTACK: echo suppression vs the chip-label lens', () => {
  it('markdown-only difference: pinned "**Seat pin 4**" vs prev "Seat pin 4" must not double-render', () => {
    const pinned = { body: '**Seat pin 4**', pinned: true }
    // Both surfaces display the identical words:
    expect(noteChipLabel(pinned.body)).toBe('Seat pin 4')
    expect(noteChipLabel('Seat pin 4')).toBe('Seat pin 4')
    // …so per "one surface per fact" the echo must be suppressed.
    expect(lastSessionEcho('Seat pin 4', '', pinned)).toBeNull()
  })

  it('multi-line pinned note whose first line equals the prev note must not double-render', () => {
    const pinned = { body: 'Seat pin 4\nMore detail below', pinned: true }
    expect(noteChipLabel(pinned.body)).toBe('Seat pin 4')
    expect(lastSessionEcho('Seat pin 4', '', pinned)).toBeNull()
  })

  it('80-char truncation collision: labels identical after the cap must not double-render', () => {
    const prefix = 'x'.repeat(90)
    const pinned = { body: `${prefix} pinned tail`, pinned: true }
    const prev = `${prefix} session tail`
    // Both truncate to the same 80-char label — visually indistinguishable.
    expect(noteChipLabel(pinned.body)).toBe(noteChipLabel(prev))
    expect(lastSessionEcho(prev, '', pinned)).toBeNull()
  })

  // Clean-attack direction: false SUPPRESSION is impossible by construction —
  // raw equality implies label equality, so a suppressed echo is always a
  // genuine display duplicate. Pinned/echoed pairs that merely LOOK different
  // raw (whitespace) are already normalized by the trim.
  it('raw-identical notes stay suppressed regardless of length (no false suppression)', () => {
    const long = 'y'.repeat(200)
    expect(lastSessionEcho(long, '', { body: long, pinned: true })).toBe(null)
    expect(lastSessionEcho(`  ${long}\n`, '', { body: `${long} `, pinned: true })).toBeNull()
  })

  it('a genuinely different short note is never falsely suppressed', () => {
    expect(
      lastSessionEcho('Felt strong', '', { body: 'Seat pin 4', pinned: true }),
    ).toBe('Felt strong')
  })
})

describe('ATTACK: whitespace-only current note is "not a note yet" (the module contract)', () => {
  // This is the module's OWN definition (identity-note.test.ts pins it): a
  // whitespace-only session note keeps the echo offered. The logger's chip
  // gate must agree — see workout-logger-notes.attack.test.tsx for the
  // render-level half of this attack.
  it('echo stays offered over a whitespace-only current note', () => {
    expect(lastSessionEcho('Felt strong', '   \n\t', null)).toBe('Felt strong')
  })
})

describe('ATTACK: stickyNote blank-body edges', () => {
  it('a pinned note with a whitespace-only body still passes the gate (chip would render empty)', () => {
    // Boundary note: parseExerciseNoteInput rejects blank bodies, so this is
    // unreachable via the app's own write path — documented, not a defect.
    const blankPinned = { body: '   ', pinned: true }
    expect(stickyNote(undefined, blankPinned)).toEqual(blankPinned)
    expect(noteChipLabel('   ')).toBe('')
  })
})
