import { describe, expect, it } from 'vitest'
import { plateChipLabel } from './plate-chip'

const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25]

describe('plateChipLabel', () => {
  it('formats an exact per-side breakdown', () => {
    // 100 kg on a 20 kg bar = 40 per side = 25 + 15
    expect(plateChipLabel('100', 20, KG_PLATES)).toBe('25 + 15 / side')
  })

  it('says "bar only" when the weight equals the bar', () => {
    expect(plateChipLabel('20', 20, KG_PLATES)).toBe('bar only')
  })

  it('prefixes ≈ when the weight is not exactly buildable', () => {
    // 101 kg → per side 40.5 unbuildable exactly with these plates ending at 1.25
    expect(plateChipLabel('101', 20, [25, 20, 15, 10, 5])).toBe('≈ 25 + 15 / side')
  })

  it('returns null when the weight sits below the bar', () => {
    expect(plateChipLabel('15', 20, KG_PLATES)).toBe(null)
  })

  it('returns null for text that does not parse to a positive weight', () => {
    expect(plateChipLabel('', 20, KG_PLATES)).toBe(null)
    expect(plateChipLabel('abc', 20, KG_PLATES)).toBe(null)
    expect(plateChipLabel('0', 20, KG_PLATES)).toBe(null)
    expect(plateChipLabel('-50', 20, KG_PLATES)).toBe(null)
  })

  it('handles fractional plates without float drift', () => {
    // 102.5 kg on a 20 kg bar = 41.25 per side = 25 + 15 + 1.25
    expect(plateChipLabel('102.5', 20, KG_PLATES)).toBe('25 + 15 + 1.25 / side')
  })

  it('supports a zero bar (plate-loaded machines)', () => {
    // 50 → 25 per side = 25
    expect(plateChipLabel('50', 0, KG_PLATES)).toBe('25 / side')
  })
})
