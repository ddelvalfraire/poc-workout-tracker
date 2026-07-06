import { describe, it, expect } from 'vitest'
import { parseEquipmentInput, equipmentForUnit, DEFAULT_EQUIPMENT } from './equipment'

const VALID = { unit: 'lb', bars: [45, 35], plates: [45, 25, 10, 5, 2.5] }

describe('parseEquipmentInput', () => {
  it('accepts valid equipment and normalizes to deduped, heaviest-first', () => {
    // Act — unsorted with a duplicate
    const parsed = parseEquipmentInput({ unit: 'lb', bars: [35, 45, 35], plates: [2.5, 45, 25, 45] })

    // Assert
    expect(parsed).toEqual({ unit: 'lb', bars: [45, 35], plates: [45, 25, 2.5] })
  })

  it('rejects a missing or unknown unit', () => {
    expect(() => parseEquipmentInput({ ...VALID, unit: 'stone' })).toThrow("unit must be 'kg' or 'lb'")
    expect(() => parseEquipmentInput({ bars: [45], plates: [45] })).toThrow()
  })

  it('rejects empty, oversized, and out-of-range weight lists', () => {
    expect(() => parseEquipmentInput({ ...VALID, plates: [] })).toThrow('must not be empty')
    expect(() => parseEquipmentInput({ ...VALID, plates: Array.from({ length: 13 }, (_, i) => i + 1) })).toThrow('at most')
    expect(() => parseEquipmentInput({ ...VALID, plates: [455] })).toThrow('between 0 and')
    expect(() => parseEquipmentInput({ ...VALID, bars: [-45] })).toThrow('between 0 and')
    expect(() => parseEquipmentInput({ ...VALID, bars: ['45'] })).toThrow('between 0 and')
  })

  it('rejects non-objects', () => {
    expect(() => parseEquipmentInput(null)).toThrow('must be an object')
  })
})

describe('equipmentForUnit', () => {
  it('returns stored equipment when the unit matches', () => {
    expect(equipmentForUnit(VALID, 'lb')).toEqual({ bars: [45, 35], plates: [45, 25, 10, 5, 2.5] })
  })

  it('falls back to defaults on a unit mismatch (plates are not convertible)', () => {
    expect(equipmentForUnit(VALID, 'kg')).toEqual(DEFAULT_EQUIPMENT.kg)
  })

  it('falls back to defaults for null and malformed storage', () => {
    expect(equipmentForUnit(null, 'lb')).toEqual(DEFAULT_EQUIPMENT.lb)
    expect(equipmentForUnit({ unit: 'lb', bars: [45] }, 'lb')).toEqual(DEFAULT_EQUIPMENT.lb)
  })
})
