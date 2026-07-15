import { describe, it, expect } from 'vitest'
import { allTimePRIndex, type PRCandidateSet } from './pr-detection'
import { displayToKg, kgToDisplay } from './units'

/** One candidate set; overrides on top of a completed 5×100 default. */
function set(over: Partial<PRCandidateSet> = {}): PRCandidateSet {
  return { reps: '5', weight: '100', completed: true, ...over }
}

describe('allTimePRIndex', () => {
  it('flags the set that strictly beats the all-time best', () => {
    // 5×105 → e1rm 122.5 vs best 120
    const sets = [set(), set({ weight: '105' })]

    expect(allTimePRIndex(sets, 'weight_reps', 'kg', 120)).toBe(1)
  })

  it('never flags a set that only equals the record', () => {
    // 5×100 → e1rm exactly 116.666…; best identical
    const best = 100 * (1 + 5 / 30)

    expect(allTimePRIndex([set()], 'weight_reps', 'kg', best)).toBeNull()
  })

  it('claims no PR without a baseline', () => {
    expect(allTimePRIndex([set({ weight: '500' })], 'weight_reps', 'kg', null)).toBeNull()
  })

  it('never flags bodyweight-type exercises (no client-side load basis)', () => {
    for (const type of ['bodyweight_reps', 'weighted_bodyweight', 'assisted_bodyweight'] as const) {
      expect(allTimePRIndex([set({ weight: '500' })], type, 'kg', 1)).toBeNull()
    }
  })

  it('ignores uncompleted sets entirely', () => {
    const sets = [set({ weight: '90' }), set({ weight: '200', completed: false })]

    expect(allTimePRIndex(sets, 'weight_reps', 'kg', 120)).toBeNull()
  })

  it('flags only the session best when several sets beat the record', () => {
    // 122.5, 128.3…, 122.5 — single winner at index 1
    const sets = [set({ weight: '105' }), set({ weight: '110' }), set({ weight: '105' })]

    expect(allTimePRIndex(sets, 'weight_reps', 'kg', 100)).toBe(1)
  })

  it('keeps in-session ties on the earliest set', () => {
    const sets = [set({ weight: '110' }), set({ weight: '110' })]

    expect(allTimePRIndex(sets, 'weight_reps', 'kg', 100)).toBe(0)
  })

  it('never flags blank or garbage inputs', () => {
    const sets = [
      set({ reps: '', weight: '100' }),
      set({ reps: 'abc', weight: '100' }),
      set({ reps: '5', weight: '' }),
      set({ reps: '5', weight: '12abc' }),
      set({ reps: '0', weight: '100' }),
      set({ reps: '5', weight: '-10' }),
      // Fractional reps: the save path truncates '5.9' → 5, so scoring 5.9
      // live would flag a phantom — rejected outright.
      set({ reps: '5.9', weight: '1000' }),
      // Hex sneaks through bare Number() ('0x12' → 18) but not the save path.
      set({ reps: '0x12', weight: '100' }),
      set({ reps: '5', weight: '0x99' }),
      set({ reps: '5e1', weight: '100' }),
    ]

    expect(allTimePRIndex(sets, 'weight_reps', 'kg', 1)).toBeNull()
  })

  it('converts lb inputs to kg before comparing', () => {
    // 5×225 lb ≈ 5×102.06 kg → e1rm ≈ 119.07 kg — beats a 118 kg record.
    expect(allTimePRIndex([set({ weight: '225' })], 'weight_reps', 'lb', 118)).toBe(0)
  })

  it('treats a stored record re-entered in lb as equal, not a new PR', () => {
    // Round-trip: record set at X kg, typed back as its lb display value.
    // lb display rounding can round UP (102.5 kg → 226.0 lb → 102.51 kg), so
    // the re-entered e1rm can exceed the record by grams — the epsilon must
    // swallow that phantom, and the assertion below proves the drift is real.
    const recordKg = 102.5 * (1 + 5 / 30)
    const lbDisplay = kgToDisplay(102.5, 'lb') // what the lifter sees and types
    const reenteredE1rm = displayToKg(lbDisplay, 'lb') * (1 + 5 / 30)

    expect(Math.abs(reenteredE1rm - recordKg)).toBeGreaterThan(0) // drift exists
    expect(
      allTimePRIndex([set({ weight: String(lbDisplay) })], 'weight_reps', 'lb', recordKg),
    ).toBeNull()
  })

  it('still flags a genuine PR by one real plate increment in lb', () => {
    // Record 102.5 kg ×5; next session 105 kg ≈ 231.5 lb ×5 — clearly past epsilon.
    const recordE1rm = 102.5 * (1 + 5 / 30)

    expect(
      allTimePRIndex([set({ weight: '231.5' })], 'weight_reps', 'lb', recordE1rm),
    ).toBe(0)
  })
})
