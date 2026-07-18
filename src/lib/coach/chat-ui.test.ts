import { describe, expect, test } from 'vitest'
import {
  formatToolInput,
  humanizeToolName,
  parseCoachError,
  parseContextParam,
  toolStatusLabel,
} from './chat-ui'

describe('humanizeToolName', () => {
  test('converts snake_case to sentence case', () => {
    expect(humanizeToolName('add_program_exercise')).toBe('Add program exercise')
    expect(humanizeToolName('remove_program_set_override')).toBe('Remove program set override')
  })

  test('handles single-word names', () => {
    expect(humanizeToolName('whoami')).toBe('Whoami')
  })

  test('returns input unchanged when there are no words', () => {
    expect(humanizeToolName('')).toBe('')
  })
})

describe('toolStatusLabel', () => {
  test('maps known read tools to friendly labels', () => {
    expect(toolStatusLabel('get_program')).toBe('Reading your program')
    expect(toolStatusLabel('list_workouts')).toBe('Looking through your workouts')
    expect(toolStatusLabel('get_last_performance')).toBe('Checking your last numbers')
  })

  test('falls back to the humanized name for unknown tools', () => {
    expect(toolStatusLabel('add_program_set')).toBe('Add program set')
  })
})

describe('parseCoachError', () => {
  test('surfaces the server error JSON verbatim', () => {
    const error = new Error(
      JSON.stringify({ error: 'Daily coach limit reached (40 messages). Try again tomorrow.' }),
    )
    expect(parseCoachError(error)).toEqual({
      kind: 'server',
      message: 'Daily coach limit reached (40 messages). Try again tomorrow.',
    })
  })

  test('classifies browser network failures as offline', () => {
    expect(parseCoachError(new TypeError('Failed to fetch')).kind).toBe('offline')
    expect(parseCoachError(new TypeError('Load failed')).kind).toBe('offline')
    expect(
      parseCoachError(new TypeError('NetworkError when attempting to fetch resource.')).kind,
    ).toBe('offline')
  })

  test('falls back to a generic message for non-JSON bodies', () => {
    expect(parseCoachError(new Error('<html>gateway timeout</html>'))).toEqual({
      kind: 'server',
      message: 'Something went wrong. Try again.',
    })
  })

  test('falls back to a generic message for JSON without a string error field', () => {
    expect(parseCoachError(new Error('{"detail":"nope"}')).message).toBe(
      'Something went wrong. Try again.',
    )
    expect(parseCoachError(new Error('{"error":42}')).message).toBe(
      'Something went wrong. Try again.',
    )
  })

  test('handles non-Error values', () => {
    expect(parseCoachError('boom')).toEqual({
      kind: 'server',
      message: 'Something went wrong. Try again.',
    })
  })
})

describe('formatToolInput', () => {
  test('flattens an object one level to key: value lines', () => {
    expect(formatToolInput({ program_id: 'abc', reps: 8, notes: null })).toBe(
      'program_id: abc\nreps: 8\nnotes: null',
    )
  })

  test('stringifies nested values compactly', () => {
    expect(formatToolInput({ sets: [{ reps: 5 }] })).toBe('sets: [{"reps":5}]')
  })

  test('handles scalars, arrays, and empty input', () => {
    expect(formatToolInput('x')).toBe('"x"')
    expect(formatToolInput([1, 2])).toBe('[1,2]')
    expect(formatToolInput(undefined)).toBe('')
    expect(formatToolInput(null)).toBe('')
  })
})

describe('parseContextParam', () => {
  test('passes through a plain value trimmed', () => {
    expect(parseContextParam(' program:abc-123 ')).toBe('program:abc-123')
  })

  test('takes the first of a repeated param', () => {
    expect(parseContextParam(['program:a', 'program:b'])).toBe('program:a')
  })

  test('collapses blank or missing to undefined', () => {
    expect(parseContextParam(undefined)).toBeUndefined()
    expect(parseContextParam('')).toBeUndefined()
    expect(parseContextParam('   ')).toBeUndefined()
    expect(parseContextParam([])).toBeUndefined()
  })

  test('caps the length at the server bound', () => {
    expect(parseContextParam('x'.repeat(600))).toHaveLength(500)
  })
})
