import { describe, it, expect } from 'vitest'
import { nextBlockName, MAX_PROGRAM_NAME } from './block-name'

describe('nextBlockName', () => {
  it('stamps a plain name as Block 2', () => {
    expect(nextBlockName('Upper/Lower')).toBe('Upper/Lower — Block 2')
  })

  it('increments an existing block suffix', () => {
    expect(nextBlockName('PPL — Block 2')).toBe('PPL — Block 3')
  })

  it('handles multi-digit block numbers', () => {
    expect(nextBlockName('X — Block 99')).toBe('X — Block 100')
  })

  it('leaves an em dash inside the base name alone (suffix is end-anchored)', () => {
    expect(nextBlockName('Push — Pull')).toBe('Push — Pull — Block 2')
  })

  it('clamps a maximum-length name so the result stays a valid program name', () => {
    const longName = 'a'.repeat(MAX_PROGRAM_NAME)

    const result = nextBlockName(longName)

    expect(result.length).toBeLessThanOrEqual(MAX_PROGRAM_NAME)
    expect(result.endsWith(' — Block 2')).toBe(true)
  })
})
