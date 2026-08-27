import { describe, it, expect } from 'vitest'
import { reachDivergence, reachWeeks } from './reach-view'
import type { SourceOverride, SourceSet } from './editor-view'

const override = (patch: Partial<SourceOverride> & { week: number }): SourceOverride => ({
  repMin: null,
  repMax: null,
  rir: null,
  rpe: null,
  suggestedLoadKg: null,
  ...patch,
})

const set = (patch: Partial<SourceSet> = {}): SourceSet => ({
  setNumber: 1,
  setType: 'working',
  repMin: 10,
  repMax: 10,
  rir: 2,
  rpe: null,
  suggestedLoadKg: 60,
  overrides: [],
  ...patch,
})

/** Week 3 pinned to 65 against a template of 60 — the artboard's case. */
const pinned = { set: set({ overrides: [override({ week: 3, suggestedLoadKg: 65 })] }), week: 3 }
const WEEKS = [1, 2, 3, 4, 5, 6]

describe('reachDivergence', () => {
  it('reports what moved when the week is pinned away from the template', () => {
    expect(reachDivergence(pinned)).toEqual({ fromKg: 60, toKg: 65 })
  })

  it('is silent when the week carries no pin at all', () => {
    expect(reachDivergence({ set: set(), week: 3 })).toBeNull()
  })

  it('is silent when the pin names no load', () => {
    // A reps-only pin reaches nothing about weight, and a sheet asking how far
    // a weight should reach would be about a change that did not happen.
    const repsOnly = { set: set({ overrides: [override({ week: 3, repMax: 12 })] }), week: 3 }
    expect(reachDivergence(repsOnly)).toBeNull()
  })

  it('is silent when the pin matches the template', () => {
    // A pin equal to the rule reaches nowhere new. Asking anyway is how a
    // sheet gets dismissed unread.
    const same = { set: set({ overrides: [override({ week: 3, suggestedLoadKg: 60 })] }), week: 3 }
    expect(reachDivergence(same)).toBeNull()
  })

  it('reports a divergence from a template that names no load', () => {
    const fromNothing = {
      set: set({ suggestedLoadKg: null, overrides: [override({ week: 2, suggestedLoadKg: 40 })] }),
      week: 2,
    }
    expect(reachDivergence(fromNothing)).toEqual({ fromKg: null, toKg: 40 })
  })
})

describe('reachWeeks · this week only', () => {
  const strip = reachWeeks(pinned, WEEKS, 'week', [], 'kg')

  it('leaves every other week following the rule', () => {
    expect(strip.map((entry) => entry.load)).toEqual([60, 60, 65, 60, 60, 60])
  })

  it('marks the pinned week alone as the change', () => {
    expect(strip.filter((entry) => entry.changes).map((entry) => entry.week)).toEqual([3])
  })
})

describe('reachWeeks · the plan', () => {
  const strip = reachWeeks(pinned, WEEKS, 'plan', [], 'kg')

  it('moves every week that has no pin of its own', () => {
    expect(strip.map((entry) => entry.load)).toEqual([65, 65, 65, 65, 65, 65])
  })

  it('marks the weeks whose number actually moves', () => {
    expect(strip.filter((entry) => entry.changes).map((entry) => entry.week)).toEqual(WEEKS)
  })

  it('leaves a separately pinned week on its own number', () => {
    // The promise made on every surface: pinned weeks stay pinned even when
    // you change the rule. The strip has to show it holding.
    const alsoPinned = {
      set: set({
        overrides: [
          override({ week: 3, suggestedLoadKg: 65 }),
          override({ week: 5, suggestedLoadKg: 50 }),
        ],
      }),
      week: 3,
    }
    const rows = reachWeeks(alsoPinned, WEEKS, 'plan', [], 'kg')
    expect(rows.find((entry) => entry.week === 5)).toMatchObject({ load: 50, changes: false })
  })
})

describe('reachWeeks · settled weeks', () => {
  it('flags the weeks whose session is already settled', () => {
    const rows = reachWeeks(pinned, WEEKS, 'plan', [1, 2], 'kg')
    expect(rows.filter((entry) => entry.settled).map((entry) => entry.week)).toEqual([1, 2])
  })

  it('still shows the plan number for a settled week, flagged as such', () => {
    // The number is the PLAN's and is not what was lifted. It is shown so the
    // strip stays a strip, and flagged so the sheet can say which it is —
    // never dressed up as a logged figure.
    const rows = reachWeeks(pinned, WEEKS, 'plan', [1], 'kg')
    expect(rows[0]).toMatchObject({ week: 1, load: 65, settled: true })
  })
})

describe('reachWeeks · edges', () => {
  it('marks nothing when there is no divergence to reach with', () => {
    const rows = reachWeeks({ set: set(), week: 3 }, WEEKS, 'plan', [], 'kg')
    expect(rows.some((entry) => entry.changes)).toBe(false)
    expect(rows.map((entry) => entry.load)).toEqual([60, 60, 60, 60, 60, 60])
  })

  it('reports no load rather than zero where the plan names none', () => {
    const rows = reachWeeks(
      {
        set: set({ suggestedLoadKg: null, overrides: [override({ week: 3, repMax: 12 })] }),
        week: 3,
      },
      [1, 2, 3],
      'week',
      [],
      'kg',
    )
    expect(rows.map((entry) => entry.load)).toEqual([null, null, null])
  })

  it('converts into the display unit', () => {
    const rows = reachWeeks(pinned, [3], 'week', [], 'lb')
    expect(rows[0].load).toBeGreaterThan(140)
  })

  it('renders the weeks it is given, including any past the block', () => {
    const rows = reachWeeks(pinned, [1, 2, 3, 4, 5, 6, 7, 8], 'plan', [], 'kg')
    expect(rows.map((entry) => entry.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})
