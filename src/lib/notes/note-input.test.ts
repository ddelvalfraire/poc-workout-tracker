import { describe, it, expect } from 'vitest'
import {
  isNoteAuthor,
  isNoteAnchorKind,
  parseNoteAnchor,
  parseNoteBody,
  NOTE_ANCHOR_KINDS,
} from './note-input'

const UUID = '01234567-89ab-cdef-0123-456789abcdef'

describe('isNoteAuthor', () => {
  it('accepts the whitelist and rejects everything else', () => {
    expect(isNoteAuthor('user')).toBe(true)
    expect(isNoteAuthor('coach')).toBe(true)
    expect(isNoteAuthor('admin')).toBe(false)
    expect(isNoteAuthor(undefined)).toBe(false)
  })
})

describe('isNoteAnchorKind', () => {
  it('accepts the four kinds only', () => {
    for (const kind of NOTE_ANCHOR_KINDS) expect(isNoteAnchorKind(kind)).toBe(true)
    expect(isNoteAnchorKind('exercise')).toBe(false)
    expect(isNoteAnchorKind(null)).toBe(false)
  })
})

describe('parseNoteAnchor', () => {
  it('returns the kind and lower-cased uuid', () => {
    expect(parseNoteAnchor({ kind: 'set', id: UUID.toUpperCase() })).toEqual({
      kind: 'set',
      id: UUID,
    })
  })

  it('rejects unknown kinds', () => {
    expect(() => parseNoteAnchor({ kind: 'exercise', id: UUID })).toThrow(/kind/)
  })

  it('rejects non-uuid ids', () => {
    expect(() => parseNoteAnchor({ kind: 'workout', id: 'new' })).toThrow(/uuid/)
    expect(() => parseNoteAnchor({ kind: 'workout', id: 42 })).toThrow(/string/)
  })

  it('rejects non-objects', () => {
    expect(() => parseNoteAnchor('set')).toThrow(/object/)
  })
})

describe('parseNoteBody', () => {
  it('trims and returns the body', () => {
    expect(parseNoteBody('  left shoulder clicked  ')).toBe('left shoulder clicked')
  })

  it('rejects blank bodies (required, unlike the legacy optional columns)', () => {
    expect(() => parseNoteBody('   ')).toThrow(/empty/)
    expect(() => parseNoteBody(undefined)).toThrow(/empty/)
  })

  it('rejects over-cap bodies via the shared parseNotes rule (2000)', () => {
    expect(() => parseNoteBody('x'.repeat(2001))).toThrow(/2000/)
  })

  it('rejects non-strings', () => {
    expect(() => parseNoteBody(42)).toThrow(/string/)
  })
})
