/**
 * Adversarial regression tests for the duration/distance codecs — hostile
 * strings, exact boundary values, and round-trips. Adopted from the
 * adversarial verification round.
 */
import { describe, it, expect } from 'vitest'
import {
  MAX_DURATION_SEC,
  formatDurationInput,
  parseDurationInput,
  formatDistanceInput,
  parseDistanceInput,
} from './duration'

describe('parseDurationInput — hostile strings', () => {
  it.each([
    ['1:1:1:1', null], // four segments
    [':30', null], // missing minutes
    ['1:.5', null], // fractional colon segment
    ['1e3', null], // exponent notation is not a bare number here
    ['0:00', null], // zero duration is not loggable
    ['0', null], // bare zero minutes
    ['0.0', null],
    ['-5', null], // negative minutes
    ['+5', null], // signed
    ['5,5', null], // locale decimal comma
    ['1:75', null], // seconds past 59
    ['0:60', null],
    ['1:75:00', null], // minutes past 59 WITH an hours part
    ['24:00:01', null], // one past the 24h ceiling
    ['25:00:00', null],
    ['1441', null], // 1441 min = 86460 s > ceiling
    ['Infinity', null],
    ['NaN', null],
    ['12:3O', null], // letter O
    ['٠١:30', null], // Arabic-Indic digits
    ['١٢', null], // Arabic-Indic bare number
    ['１２', null], // fullwidth digits
    ['12:30:15:00', null],
    ['12::30', null],
    ['', null],
    ['   ', null],
  ])('rejects %j', (input, expected) => {
    expect(parseDurationInput(input)).toBe(expected)
  })

  it('accepts the documented shapes', () => {
    expect(parseDurationInput('12:30')).toBe(750)
    expect(parseDurationInput('1:05:05')).toBe(3905)
    expect(parseDurationInput('30')).toBe(1800) // bare number = minutes
    expect(parseDurationInput('1.5')).toBe(90) // decimal minutes
    expect(parseDurationInput(' 12:30 ')).toBe(750) // trimmed
    expect(parseDurationInput('75:30')).toBe(4530) // mm:ss past 59 min, no hour part
    expect(parseDurationInput('0:01')).toBe(1)
  })

  it('holds the 24h boundary exactly: "24:00:00" and bare "1440" are the ceiling', () => {
    expect(parseDurationInput('24:00:00')).toBe(86_400)
    expect(parseDurationInput('1440')).toBe(86_400)
    expect(MAX_DURATION_SEC).toBe(86_400)
  })

  it('quirk probe: minutes segment caps at 2 digits — "100:30" must be typed "1:40:30"', () => {
    expect(parseDurationInput('99:30')).toBe(5970)
    expect(parseDurationInput('100:30')).toBeNull()
  })
})

describe('duration round-trips', () => {
  it('parse ∘ format is the identity for representable positive second values (sampled)', () => {
    const samples = [1, 59, 60, 61, 599, 600, 3599, 3600, 3661, 86_399, 86_400, 750, 4530]
    for (const s of samples) {
      expect(parseDurationInput(formatDurationInput(s)), `sec=${s}`).toBe(s)
    }
  })

  it('format pads sub-minute values to a clock reading', () => {
    expect(formatDurationInput(45)).toBe('0:45')
    expect(formatDurationInput(86_400)).toBe('24:00:00')
  })
})

describe('parseDistanceInput — hostile strings', () => {
  it.each([
    ['-1', null],
    ['+1', null],
    ['1e3', null],
    ['1,5', null],
    ['.', null],
    ['.5', null], // no leading digit — regex requires \d+
    ['0', null], // zero distance is not loggable
    ['0.0000049', null], // rounds to 0 cm → null
    ['10000', null], // 10,000 km = 10,000,000 m > numeric(9,2) ceiling
    ['Infinity', null],
    ['١', null],
    ['', null],
    ['  ', null],
  ])('rejects %j', (input, expected) => {
    expect(parseDistanceInput(input)).toBe(expected)
  })

  it('accepts km decimals and stores centimeter-rounded meters', () => {
    expect(parseDistanceInput('5')).toBe(5000)
    expect(parseDistanceInput('0.4')).toBe(400)
    expect(parseDistanceInput('1.23456')).toBe(1234.56)
    expect(parseDistanceInput('1.234564')).toBe(1234.56) // sub-cm noise rounded down
    // Tie at exactly half a cm: binary fp puts 1.234565*100000 at
    // 123456.49999…, so the tie rounds DOWN — still nearest-cm correct
    // (the codec's contract), just not half-up. Documented, not a bug.
    expect(parseDistanceInput('1.234565')).toBe(1234.56)
    expect(parseDistanceInput('1.234566')).toBe(1234.57)
  })

  it('holds the numeric(9,2) ceiling exactly, rejecting the first value that rounds past it', () => {
    expect(parseDistanceInput('9999.99999')).toBe(9_999_999.99)
    expect(parseDistanceInput('9999.999995')).toBeNull() // rounds to 10,000,000.00
    expect(parseDistanceInput('10000.00001')).toBeNull()
  })

  it('cm-precision claim: an MCP-authored 1234.56 m survives the untouched edit round-trip', () => {
    expect(parseDistanceInput(formatDistanceInput(1234.56))).toBe(1234.56)
    expect(parseDistanceInput(formatDistanceInput(9_999_999.99))).toBe(9_999_999.99)
    expect(parseDistanceInput(formatDistanceInput(0.01))).toBe(0.01) // 1 cm
  })

  it('format clamps negatives and never emits exponent notation for cm-grain values', () => {
    expect(formatDistanceInput(-5)).toBe('0')
    expect(formatDistanceInput(0.01)).not.toMatch(/e/i)
  })
})

describe('zero is unrepresentable by design (D6 resolution)', () => {
  // A stored 0 can never exist: the wire (parseWorkoutInput) normalizes
  // durationSec/distanceM 0 → null and the MCP set tools reject 0 outright,
  // so the codecs' refusal to parse "0:00"/"0" back is safe — there is no row
  // for it to lossily round-trip from.
  it('formatDurationInput(0) renders "0:00", which parses to null', () => {
    expect(formatDurationInput(0)).toBe('0:00')
    expect(parseDurationInput(formatDurationInput(0))).toBeNull()
  })

  it('formatDistanceInput(0) renders "0", which parses to null', () => {
    expect(formatDistanceInput(0)).toBe('0')
    expect(parseDistanceInput(formatDistanceInput(0))).toBeNull()
  })
})
