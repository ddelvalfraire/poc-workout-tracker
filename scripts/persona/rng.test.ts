import { describe, expect, it } from 'vitest'
import { createRng } from './rng'

function sample(rng: () => number, n: number): number[] {
  return Array.from({ length: n }, () => rng())
}

describe('createRng', () => {
  it('produces identical sequences for the same seed', () => {
    const seqA = sample(createRng(42), 10)
    const seqB = sample(createRng(42), 10)
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const seqA = sample(createRng(1), 10)
    const seqB = sample(createRng(2), 10)
    expect(seqA).not.toEqual(seqB)
  })
})
