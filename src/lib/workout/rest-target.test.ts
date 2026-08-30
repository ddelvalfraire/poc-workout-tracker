import { describe, it, expect } from 'vitest'
import { resolveRestTarget } from './rest-target'

/** A plan slot with only the field this module reads. */
const slot = (restSec: number | null) => ({ restSec })

describe('resolveRestTarget', () => {
  it('returns the completed set’s plan restSec when prescribed', () => {
    // Act
    const result = resolveRestTarget(slot(90), 60)

    // Assert — the per-set prescription wins over the session default
    expect(result).toBe(90)
  })

  it('falls back to the session default when the plan slot has no restSec', () => {
    // Act
    const result = resolveRestTarget(slot(null), 75)

    // Assert
    expect(result).toBe(75)
  })

  it('falls back to the session default when the set has no plan slot (extra set / ad-hoc exercise)', () => {
    // Act
    const result = resolveRestTarget(undefined, 60)

    // Assert
    expect(result).toBe(60)
  })

  it('returns null when neither a plan restSec nor a session default exists', () => {
    // Act + Assert — count-up only
    expect(resolveRestTarget(undefined, null)).toBeNull()
    expect(resolveRestTarget(slot(null), null)).toBeNull()
  })

  it('lets a plan restSec of 0 stand (explicit "no rest", not a fallback)', () => {
    // Act + Assert — ?? (not ||) semantics: 0 must not fall through
    expect(resolveRestTarget(slot(0), 120)).toBe(0)
  })
})
