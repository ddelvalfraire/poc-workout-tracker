import { describe, it, expect } from 'vitest'
import { resolveRestTarget } from './rest-target'

/** Plan slots with only the field this module reads. */
const plan = (...restSecs: (number | null)[]) => restSecs.map((restSec) => ({ restSec }))

describe('resolveRestTarget', () => {
  it('returns the completed set’s plan restSec when prescribed', () => {
    // Arrange
    const targets = plan(120, 90, 180)

    // Act
    const result = resolveRestTarget(targets, 1, 60)

    // Assert — the per-set prescription wins over the session default
    expect(result).toBe(90)
  })

  it('falls back to the session default when the plan slot has no restSec', () => {
    // Arrange
    const targets = plan(120, null)

    // Act
    const result = resolveRestTarget(targets, 1, 75)

    // Assert
    expect(result).toBe(75)
  })

  it('falls back to the session default for an index beyond the plan (no clamping, mirroring placeholderForSet)', () => {
    // Arrange — 2 planned sets, the user logged a 3rd
    const targets = plan(120, 90)

    // Act
    const result = resolveRestTarget(targets, 2, 60)

    // Assert — overflow does NOT adopt the last slot's 90
    expect(result).toBe(60)
  })

  it('falls back to the session default when there are no plan targets at all (ad-hoc exercise)', () => {
    // Act
    const result = resolveRestTarget(undefined, 0, 90)

    // Assert
    expect(result).toBe(90)
  })

  it('returns null when neither a plan restSec nor a session default exists', () => {
    // Act + Assert — count-up only
    expect(resolveRestTarget(undefined, 0, null)).toBeNull()
    expect(resolveRestTarget(plan(null), 0, null)).toBeNull()
    expect(resolveRestTarget(plan(60), 3, null)).toBeNull()
  })

  it('lets a plan restSec of 0 stand (explicit "no rest", not a fallback)', () => {
    // Arrange — 0 is a real prescription (e.g. myo-style straight into the next set)
    const targets = plan(0)

    // Act + Assert — ?? (not ||) semantics: 0 must not fall through
    expect(resolveRestTarget(targets, 0, 120)).toBe(0)
  })
})
