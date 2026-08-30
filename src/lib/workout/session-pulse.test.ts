import { describe, expect, it } from 'vitest'
import { sessionPulse, shouldShowNextUp, type PulseExercise } from './session-pulse'

function exercise(
  sets: { completed: boolean; tag?: string }[],
  skipped = false,
): PulseExercise {
  return { skipped, sets: sets.map((s) => ({ completed: s.completed, tag: s.tag ?? 'working' })) }
}

describe('sessionPulse', () => {
  it('counts completed and total working sets across exercises', () => {
    // Arrange
    const exercises = [
      exercise([{ completed: true }, { completed: true }, { completed: false }]),
      exercise([{ completed: false }, { completed: false }]),
    ]

    // Act
    const pulse = sessionPulse(exercises)

    // Assert
    expect(pulse).toEqual({ completed: 2, total: 5 })
  })

  it('excludes warm-up sets from both counts (scoring semantics)', () => {
    const exercises = [
      exercise([
        { completed: true, tag: 'warmup' },
        { completed: true },
        { completed: false, tag: 'warmup' },
        { completed: false },
      ]),
    ]
    expect(sessionPulse(exercises)).toEqual({ completed: 1, total: 2 })
  })

  it('excludes skipped exercises wholesale', () => {
    const exercises = [
      exercise([{ completed: true }], true),
      exercise([{ completed: true }, { completed: false }]),
    ]
    expect(sessionPulse(exercises)).toEqual({ completed: 1, total: 2 })
  })

  it('returns zeros for an empty session', () => {
    expect(sessionPulse([])).toEqual({ completed: 0, total: 0 })
  })

  it('returns zero total when every set is a warm-up', () => {
    const exercises = [exercise([{ completed: true, tag: 'warmup' }])]
    expect(sessionPulse(exercises)).toEqual({ completed: 0, total: 0 })
  })
})

describe('shouldShowNextUp', () => {
  it('shows with more than one exercise, even before any set is done', () => {
    expect(
      shouldShowNextUp([exercise([{ completed: false }]), exercise([{ completed: false }])]),
    ).toBe(true)
  })

  it('shows for a single exercise once a set is completed', () => {
    expect(shouldShowNextUp([exercise([{ completed: true }, { completed: false }])])).toBe(true)
  })

  it('a completed WARM-UP also counts as underway', () => {
    // The gate asks "has the session started", not "has anything scored".
    expect(shouldShowNextUp([exercise([{ completed: true, tag: 'warmup' }])])).toBe(true)
  })

  it('hides for a single untouched exercise', () => {
    expect(shouldShowNextUp([exercise([{ completed: false }, { completed: false }])])).toBe(false)
  })

  it('hides for an empty session', () => {
    expect(shouldShowNextUp([])).toBe(false)
  })
})
