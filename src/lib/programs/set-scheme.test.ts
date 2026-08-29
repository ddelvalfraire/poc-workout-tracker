import { describe, it, expect } from 'vitest'
import {
  parseSetScheme,
  MAX_SCHEME_SETS,
  MAX_SCHEME_REPS,
  MAX_SCHEME_INPUT,
  type SchemeSet,
} from './set-scheme'

/**
 * The parser's contract has two halves and both matter equally: an accepted
 * string expands to EXACTLY the sets it promises, and a rejected string comes
 * back with a reason a human can act on. The malformed cases below therefore
 * assert on the message content, not merely on `ok: false` — a parser that
 * fails with "invalid input" fails the requirement just as badly as one that
 * guesses.
 */

/** The sets, or a thrown assertion naming why the parse failed. */
function sets(input: string): SchemeSet[] {
  const result = parseSetScheme(input)
  if (!result.ok) throw new Error(`expected "${input}" to parse, got: ${result.error.message}`)
  return result.sets
}

/** The error, or a thrown assertion showing what parsed instead. */
function error(input: string): { message: string; token?: string } {
  const result = parseSetScheme(input)
  if (result.ok) {
    throw new Error(`expected "${input}" to be refused, got ${result.sets.length} sets`)
  }
  return result.error
}

const plain = (repMin: number, repMax = repMin): SchemeSet => ({
  repMin,
  repMax,
  rir: null,
  rpe: null,
  load: null,
})

describe('parseSetScheme — list form', () => {
  it('expands a comma list into one set per entry, in order', () => {
    // Arrange / Act
    const result = sets('5,5,3,3,1')

    // Assert
    expect(result).toEqual([plain(5), plain(5), plain(3), plain(3), plain(1)])
  })

  it('tolerates whitespace around the commas', () => {
    expect(sets(' 5 , 5 ,3 ')).toEqual([plain(5), plain(5), plain(3)])
  })

  it('reads a fixed rep count as a degenerate range (min === max)', () => {
    expect(sets('8')).toEqual([plain(8, 8)])
  })

  it('accepts a rep range per entry', () => {
    expect(sets('8-12,6-8')).toEqual([plain(8, 12), plain(6, 8)])
  })
})

describe('parseSetScheme — multiplier form', () => {
  it('expands NxR into N identical sets', () => {
    expect(sets('3x8')).toEqual([plain(8), plain(8), plain(8)])
  })

  it('expands NxR-R into N identical ranged sets', () => {
    expect(sets('3x8-12')).toEqual([plain(8, 12), plain(8, 12), plain(8, 12)])
  })

  it('accepts uppercase X and the multiplication sign', () => {
    expect(sets('3X8')).toEqual(sets('3x8'))
    expect(sets('3×8')).toEqual(sets('3x8'))
  })

  it('accepts spaces around the multiplier', () => {
    expect(sets('3 x 8')).toEqual(sets('3x8'))
  })

  it('mixes list and multiplier segments', () => {
    expect(sets('5,5,3x3')).toEqual([plain(5), plain(5), plain(3), plain(3), plain(3)])
  })
})

describe('parseSetScheme — qualifiers', () => {
  it('applies a trailing RPE to every set', () => {
    expect(sets('3x8-12 @ 7RPE')).toEqual([
      { repMin: 8, repMax: 12, rir: null, rpe: 7, load: null },
      { repMin: 8, repMax: 12, rir: null, rpe: 7, load: null },
      { repMin: 8, repMax: 12, rir: null, rpe: 7, load: null },
    ])
  })

  it('accepts RPE written either way round, and half points', () => {
    expect(sets('3x5 @RPE8.5')[0].rpe).toBe(8.5)
    expect(sets('3x5 @8.5RPE')[0].rpe).toBe(8.5)
  })

  it('accepts RIR as the alternative effort axis', () => {
    expect(sets('4x6 @2RIR')[0]).toEqual({ repMin: 6, repMax: 6, rir: 2, rpe: null, load: null })
  })

  it('accepts a load with an explicit unit and keeps that unit unconverted', () => {
    expect(sets('5x5 @100kg')[0].load).toEqual({ value: 100, unit: 'kg' })
    expect(sets('5x5 @225lb')[0].load).toEqual({ value: 225, unit: 'lb' })
    expect(sets('5x5 @225lbs')[0].load).toEqual({ value: 225, unit: 'lb' })
  })

  it('accepts an effort and a load together', () => {
    expect(sets('3x5 @8RPE @100kg')[0]).toEqual({
      repMin: 5,
      repMax: 5,
      rir: null,
      rpe: 8,
      load: { value: 100, unit: 'kg' },
    })
  })

  it('accepts the no-@ shorthand without eating the scheme body', () => {
    expect(sets('3x8-12 7RPE')).toEqual(sets('3x8-12 @7RPE'))
  })

  it('is case-insensitive across qualifiers', () => {
    expect(sets('3x5 @8rpe @100KG')[0].load).toEqual({ value: 100, unit: 'kg' })
  })

  it('leaves unmentioned fields null rather than inventing a value', () => {
    expect(sets('3x5')[0]).toEqual({ repMin: 5, repMax: 5, rir: null, rpe: null, load: null })
  })
})

describe('parseSetScheme — malformed input fails legibly', () => {
  it('refuses an empty or whitespace-only string with an example', () => {
    expect(error('').message).toMatch(/enter a set scheme/i)
    expect(error('   ').message).toMatch(/enter a set scheme/i)
  })

  it('refuses input longer than the cap', () => {
    expect(error('5,'.repeat(MAX_SCHEME_INPUT)).message).toMatch(
      new RegExp(`at most ${MAX_SCHEME_INPUT} characters`),
    )
  })

  it('names the empty segment when commas are doubled or dangling', () => {
    expect(error('5,,3').message).toMatch(/empty segment/i)
    expect(error('5,3,').message).toMatch(/empty segment/i)
  })

  it('refuses a multiplier missing either side, and says which shape is wanted', () => {
    const missingReps = error('3x')
    expect(missingReps.message).toMatch(/reps on both sides/i)
    expect(missingReps.token).toBe('3x')
    expect(error('x8').message).toMatch(/reps on both sides/i)
  })

  it('refuses a descending rep range instead of silently swapping it', () => {
    const refused = error('3x12-8')
    expect(refused.message).toMatch(/low-to-high/i)
    expect(refused.token).toBe('3x12-8')
  })

  it('refuses a zero set count', () => {
    expect(error('0x5').message).toMatch(/at least 1/i)
  })

  it('refuses more sets than the ceiling, whether in one segment or summed', () => {
    expect(error(`${MAX_SCHEME_SETS + 1}x5`).message).toMatch(
      new RegExp(`at most ${MAX_SCHEME_SETS} sets`),
    )
    // 15 + 6 crosses the ceiling only when the segments are summed.
    expect(error('15x5,6x3').message).toMatch(new RegExp(`at most ${MAX_SCHEME_SETS} sets`))
    // Exactly at the ceiling still parses.
    expect(sets(`${MAX_SCHEME_SETS}x5`)).toHaveLength(MAX_SCHEME_SETS)
  })

  it('refuses an implausible rep count', () => {
    expect(error(`3x${MAX_SCHEME_REPS + 1}`).message).toMatch(
      new RegExp(`at most ${MAX_SCHEME_REPS}`),
    )
  })

  it('refuses a percentage and points at where percentages actually live', () => {
    const refused = error('3x5 @ 75%')
    expect(refused.message).toMatch(/progression/i)
    expect(refused.message).toMatch(/training max/i)
    expect(refused.token).toBe('75%')
  })

  it('refuses a bare number as a load — the unit is not guessable', () => {
    const refused = error('3x5 @ 100')
    expect(refused.message).toMatch(/ambiguous/i)
    expect(refused.token).toBe('100')
  })

  it('refuses out-of-range and off-step effort values', () => {
    expect(error('3x5 @11RPE').message).toMatch(/between 0 and 10/i)
    expect(error('3x5 @7.3RPE').message).toMatch(/half points/i)
    expect(error('3x5 @21RIR').message).toMatch(/between 0 and 20/i)
  })

  it('refuses RPE and RIR together — they are the same axis', () => {
    expect(error('3x5 @8RPE @2RIR').message).toMatch(/either RPE or RIR/i)
    expect(error('3x5 @2RIR @8RPE').message).toMatch(/either RPE or RIR/i)
  })

  it('refuses a repeated qualifier of the same kind', () => {
    expect(error('3x5 @7RPE @9RPE').message).toMatch(/more than once/i)
    expect(error('3x5 @100kg @120kg').message).toMatch(/more than once/i)
  })

  it('refuses a zero load', () => {
    expect(error('3x5 @0kg').message).toMatch(/greater than 0/i)
  })

  it('echoes the offending token for prose input', () => {
    const refused = error('3 sets of 8')
    expect(refused.token).toBeDefined()
    expect(refused.message).toMatch(/unrecognised qualifier|expected reps/i)
  })

  it('refuses gibberish rather than parsing a leading number out of it', () => {
    expect(error('abc').message).toBeTruthy()
    expect(error('5kg').message).toBeTruthy()
  })

  it('never throws, whatever it is handed', () => {
    const hostile = [
      '',
      '-',
      ',,,',
      '@@@',
      '5x',
      'x',
      '∞',
      '1e5',
      '5-',
      '-5',
      '3x8-',
      '3x-8',
      '3x5 @',
      '999999999999x1',
      '5,5,5 @ @ @',
      ' ',
      'NaN',
      'Infinity',
    ]
    for (const input of hostile) {
      expect(() => parseSetScheme(input)).not.toThrow()
    }
  })

  it('is total: every input lands on exactly one branch, with content', () => {
    for (const input of ['3x8', 'abc', '', '5,5,3', '@@@']) {
      const result = parseSetScheme(input)
      if (result.ok) {
        expect(result.sets.length).toBeGreaterThan(0)
      } else {
        expect(result.error.message.length).toBeGreaterThan(0)
      }
    }
  })
})
