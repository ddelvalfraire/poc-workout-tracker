import { describe, it, expect } from 'vitest'
import { defaultComparePair } from './compare-pair'

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-01-01T12:00:00Z').getTime()

function photo(id: string, pose: string | null, daysAfterT0: number) {
  return { id, pose, takenAtMs: T0 + daysAfterT0 * DAY }
}

describe('defaultComparePair', () => {
  it('is null with fewer than two photos or no same-pose pair', () => {
    expect(defaultComparePair([])).toBe(null)
    expect(defaultComparePair([photo('a', 'front', 0)])).toBe(null)
    // Two photos, different poses — apples to oranges, no default.
    expect(defaultComparePair([photo('a', 'front', 0), photo('b', 'side', 10)])).toBe(null)
  })

  it('picks earliest vs latest of the newest photo’s pose group', () => {
    const entries = [
      photo('f1', 'front', 0),
      photo('f2', 'front', 30),
      photo('s1', 'side', 10),
      photo('f3', 'front', 60), // newest overall → front group wins
      photo('s2', 'side', 40),
    ]
    const pair = defaultComparePair(entries)
    expect(pair?.map((p) => p.id)).toEqual(['f1', 'f3'])
  })

  it('falls back to the freshest pairable group when the newest photo is alone', () => {
    const entries = [
      photo('f1', 'front', 0),
      photo('f2', 'front', 30),
      photo('b1', 'back', 90), // newest, but the only back shot
    ]
    const pair = defaultComparePair(entries)
    expect(pair?.map((p) => p.id)).toEqual(['f1', 'f2'])
  })

  it('treats untagged photos as their own honest group', () => {
    const entries = [
      photo('u1', null, 0),
      photo('u2', null, 45),
      photo('f1', 'front', 20),
    ]
    const pair = defaultComparePair(entries)
    expect(pair?.map((p) => p.id)).toEqual(['u1', 'u2'])
  })

  it('prefers the fresher of two pairable groups on fallback', () => {
    const entries = [
      photo('f1', 'front', 0),
      photo('f2', 'front', 10),
      photo('s1', 'side', 5),
      photo('s2', 'side', 50),
      photo('b1', 'back', 99), // newest, alone
    ]
    const pair = defaultComparePair(entries)
    expect(pair?.map((p) => p.id)).toEqual(['s1', 's2'])
  })
})
