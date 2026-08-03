import { describe, it, expect, vi } from 'vitest'
import { cardFileName, pickShareStrategy } from './share-card'

const file = new File([new Uint8Array(8)], 'card.png', { type: 'image/png' })

describe('pickShareStrategy', () => {
  it('falls back to download when no navigator exists', () => {
    expect(pickShareStrategy(undefined, file)).toBe('download')
    expect(pickShareStrategy(null, file)).toBe('download')
  })

  it('falls back to download when share exists but canShare does not', () => {
    expect(pickShareStrategy({ share: vi.fn() }, file)).toBe('download')
  })

  it('falls back to download when canShare exists but share does not', () => {
    expect(pickShareStrategy({ canShare: () => true }, file)).toBe('download')
  })

  it('shares when canShare accepts the file', () => {
    const canShare = vi.fn(() => true)
    expect(pickShareStrategy({ share: vi.fn(), canShare }, file)).toBe('share')
    expect(canShare).toHaveBeenCalledWith({ files: [file] })
  })

  it('falls back to download when canShare rejects the file', () => {
    expect(pickShareStrategy({ share: vi.fn(), canShare: () => false }, file)).toBe('download')
  })

  it('falls back to download when canShare throws', () => {
    const canShare = () => {
      throw new TypeError('files unsupported')
    }
    expect(pickShareStrategy({ share: vi.fn(), canShare }, file)).toBe('download')
  })
})

describe('cardFileName', () => {
  it('slugs the title into a png filename', () => {
    expect(cardFileName('315 Squat Club')).toBe('315-squat-club.png')
  })

  it('collapses punctuation and trims edge dashes', () => {
    expect(cardFileName('  Bench Press — PR!  ')).toBe('bench-press-pr.png')
  })

  it('falls back to a constant name when nothing survives slugging', () => {
    expect(cardFileName('→ · —')).toBe('share-card.png')
  })
})
