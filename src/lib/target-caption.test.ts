import { describe, expect, it } from 'vitest'
import { targetCaption } from './target-caption'

describe('targetCaption', () => {
  it('shows the plan when a typed rep count differs from the target', () => {
    expect(targetCaption({ reps: '6', weight: '' }, { reps: '8–12' })).toBe('▸ 8–12')
  })

  it('shows reps and weight when the plan prescribes both', () => {
    expect(targetCaption({ reps: '6', weight: '' }, { reps: '8–12', weight: '100' })).toBe(
      '▸ 8–12 × 100',
    )
  })

  it('shows when a typed weight differs from the plan load', () => {
    expect(targetCaption({ reps: '', weight: '95' }, { reps: '8', weight: '100' })).toBe(
      '▸ 8 × 100',
    )
  })

  it('hides while nothing is typed — the ghost itself is still visible', () => {
    expect(targetCaption({ reps: '', weight: '' }, { reps: '8–12', weight: '100' })).toBe(null)
  })

  it('hides when there is no plan target at all', () => {
    expect(targetCaption({ reps: '6', weight: '80' }, {})).toBe(null)
  })

  it('hides when typed values match the plan verbatim', () => {
    expect(targetCaption({ reps: '8', weight: '100' }, { reps: '8', weight: '100' })).toBe(null)
  })

  it("hides when typed reps equal a range's adoptable floor (tap-to-accept fill)", () => {
    expect(targetCaption({ reps: '8', weight: '' }, { reps: '8–12' })).toBe(null)
  })

  it('treats numerically-equal weights as matching ("100.0" vs "100")', () => {
    expect(targetCaption({ reps: '', weight: '100.0' }, { reps: '8', weight: '100' })).toBe(null)
  })

  it('a typed value with no corresponding plan field does not trigger the caption', () => {
    // Plan prescribes reps only; typing a weight replaces no target.
    expect(targetCaption({ reps: '', weight: '80' }, { reps: '8–12' })).toBe(null)
  })

  it('whitespace-only input counts as untyped', () => {
    expect(targetCaption({ reps: '  ', weight: '' }, { reps: '8–12' })).toBe(null)
  })
})
