import { describe, it, expect } from 'vitest'
import { parseCsv, headerIndex, cell } from './csv'

describe('parseCsv', () => {
  it('parses plain rows and fields', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('name,reps\n"Bench Press, paused",5')).toEqual([
      ['name', 'reps'],
      ['Bench Press, paused', '5'],
    ])
  })

  it('unescapes doubled quotes inside quoted fields', () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', 'x']])
  })

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('"line1\nline2",x')).toEqual([['line1\nline2', 'x']])
  })

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('handles bare-CR line endings', () => {
    expect(parseCsv('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('strips a UTF-8 BOM before the first header', () => {
    expect(parseCsv('﻿Date,Reps\nx,5')).toEqual([
      ['Date', 'Reps'],
      ['x', '5'],
    ])
  })

  it('drops blank lines and the trailing newline', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('preserves empty fields', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ])
  })

  it('returns an empty list for an empty string', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('yields what was read on an unterminated quoted field', () => {
    expect(parseCsv('"unterminated,then')).toEqual([['unterminated,then']])
  })

  it('keeps a stray quote inside an unquoted field verbatim', () => {
    expect(parseCsv('5"10,x')).toEqual([['5"10', 'x']])
  })
})

describe('headerIndex + cell', () => {
  it('maps headers case-insensitively and reads cells trimmed', () => {
    const columns = headerIndex(['Date', ' Workout Name ', 'Reps'])
    expect(cell(['2024-01-15', ' Push Day ', ' 5 '], columns, 'workout name')).toBe('Push Day')
    expect(cell(['2024-01-15', 'Push Day', '5'], columns, 'reps')).toBe('5')
  })

  it('returns empty string for a missing column or short row', () => {
    const columns = headerIndex(['a', 'b'])
    expect(cell(['1'], columns, 'b')).toBe('')
    expect(cell(['1', '2'], columns, 'nope')).toBe('')
  })

  it('first occurrence wins on duplicate headers', () => {
    const columns = headerIndex(['x', 'x'])
    expect(cell(['first', 'second'], columns, 'x')).toBe('first')
  })
})
