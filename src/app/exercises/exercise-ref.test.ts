import { describe, it, expect } from 'vitest'
import { parseExerciseRef, exerciseHref } from './exercise-ref'

describe('parseExerciseRef', () => {
  it('parses valid wger and custom refs', () => {
    expect(parseExerciseRef('wger', '42')).toEqual({ source: 'wger', wgerExerciseId: 42 })
    expect(parseExerciseRef('custom', '7')).toEqual({ source: 'custom', wgerExerciseId: 7 })
  })

  it('rejects unknown sources', () => {
    expect(parseExerciseRef('foo', '42')).toBeNull()
    expect(parseExerciseRef('', '42')).toBeNull()
    expect(parseExerciseRef('WGER', '42')).toBeNull()
  })

  it('rejects non-positive and non-integer ids', () => {
    expect(parseExerciseRef('wger', '0')).toBeNull()
    expect(parseExerciseRef('wger', '-1')).toBeNull()
    expect(parseExerciseRef('wger', '1.5')).toBeNull()
    expect(parseExerciseRef('wger', '1e3')).toBeNull()
    expect(parseExerciseRef('wger', 'abc')).toBeNull()
    expect(parseExerciseRef('wger', '')).toBeNull()
  })

  it('rejects ids beyond the safe-integer range', () => {
    expect(parseExerciseRef('wger', '9007199254740993')).toBeNull()
  })
})

describe('exerciseHref', () => {
  it('round-trips with parseExerciseRef', () => {
    const ref = parseExerciseRef('custom', '42')!
    expect(exerciseHref(ref)).toBe('/exercises/custom/42')
  })
})
