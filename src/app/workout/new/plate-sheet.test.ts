import { describe, test, expect } from 'vitest'
import { COMMON_GEAR, pillOptions, parseCustomWeight, toggleValue } from './plate-sheet'

describe('parseCustomWeight', () => {
  test('parses plain and fractional weights', () => {
    expect(parseCustomWeight('45')).toBe(45)
    expect(parseCustomWeight('2.5')).toBe(2.5)
  })

  test('trims surrounding whitespace', () => {
    expect(parseCustomWeight('  10 ')).toBe(10)
  })

  test('rejects zero, negatives, and non-numeric text', () => {
    expect(parseCustomWeight('0')).toBeNull()
    expect(parseCustomWeight('-5')).toBeNull()
    expect(parseCustomWeight('abc')).toBeNull()
    expect(parseCustomWeight('')).toBeNull()
    expect(parseCustomWeight('1,5')).toBeNull()
  })
})

describe('toggleValue', () => {
  test('adds a value that is absent', () => {
    expect(toggleValue([45, 25], 10)).toEqual([45, 25, 10])
  })

  test('removes a value that is present', () => {
    expect(toggleValue([45, 25, 10], 25)).toEqual([45, 10])
  })

  test('does not mutate the input array', () => {
    const values = [45, 25]

    toggleValue(values, 10)
    toggleValue(values, 45)

    expect(values).toEqual([45, 25])
  })
})

describe('pillOptions', () => {
  test('unions common and owned, deduped, heaviest first', () => {
    // Arrange — 35 overlaps both lists; 1.5 is a custom the user owns
    const common = [45, 35, 25]
    const owned = [35, 1.5]

    // Act
    const options = pillOptions(common, owned)

    // Assert
    expect(options).toEqual([45, 35, 25, 1.5])
  })

  test('returns common denominations alone when nothing is owned', () => {
    expect(pillOptions(COMMON_GEAR.kg.bars, [])).toEqual([20, 15, 10])
  })
})
