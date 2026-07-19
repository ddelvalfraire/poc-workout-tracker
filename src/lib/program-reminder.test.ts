import { describe, it, expect } from 'vitest'
import { shouldShowProgramReminder } from './program-reminder'

describe('shouldShowProgramReminder', () => {
  it('shows for a fresh user with no program day and no dismissal', () => {
    expect(shouldShowProgramReminder(false, false)).toBe(true)
  })

  it('hides once the user has a program day — the hero owns that state', () => {
    expect(shouldShowProgramReminder(true, false)).toBe(false)
  })

  it('hides after dismissal even with no program day', () => {
    expect(shouldShowProgramReminder(false, true)).toBe(false)
  })

  it('hides when both a program day exists and the reminder is dismissed', () => {
    expect(shouldShowProgramReminder(true, true)).toBe(false)
  })
})
