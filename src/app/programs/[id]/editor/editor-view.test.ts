import { describe, it, expect } from 'vitest'
import {
  editorDayDetail,
  editorDays,
  editorSetForWeek,
  editorSetLoadKg,
  editorWeeks,
  type SourceOverride,
  type SourceSet,
} from './editor-view'

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
  repMin: 3,
  repMax: 5,
  rir: 2,
  rpe: null,
  suggestedLoadKg: 100,
  overrides: [],
  ...patch,
})

describe('editorWeeks', () => {
  it('lists the planned block when no week has been trained', () => {
    expect(editorWeeks(4, null, []).map((w) => w.week)).toEqual([1, 2, 3, 4])
  })

  it('flags the deload week', () => {
    expect(editorWeeks(4, 4, []).map((w) => w.isDeload)).toEqual([false, false, false, true])
  })

  it('keeps trained weeks that sit ABOVE mesocycleWeeks after a shrink', () => {
    // The shrink is allowed and only reported (trainedWeeksBeyond), so weeks 7
    // and 8 are real history. Looping 1..mesocycleWeeks would drop them.
    const weeks = editorWeeks(4, null, [7, 8, 2])
    expect(weeks.map((w) => w.week)).toEqual([1, 2, 3, 4, 7, 8])
    expect(weeks.filter((w) => w.isBeyondBlock).map((w) => w.week)).toEqual([7, 8])
  })

  it('does not flag trained weeks inside the block', () => {
    expect(editorWeeks(6, null, [3]).every((w) => !w.isBeyondBlock)).toBe(true)
  })

  it('deduplicates repeated workout weeks and sorts ascending', () => {
    expect(editorWeeks(1, null, [5, 5, 3]).map((w) => w.week)).toEqual([1, 3, 5])
  })

  it('always lists at least week 1, even for a zero-length block', () => {
    expect(editorWeeks(0, null, []).map((w) => w.week)).toEqual([1])
  })

  it('ignores junk week numbers rather than listing them', () => {
    expect(editorWeeks(2, null, [0, -3, 1.5, Number.NaN]).map((w) => w.week)).toEqual([1, 2])
  })
})

describe('editorDays', () => {
  it('numbers days by position and counts their exercises', () => {
    expect(
      editorDays([
        { name: 'Push', exercises: [{ name: 'Bench', sets: [] }] },
        { name: 'Pull', exercises: [] },
      ]),
    ).toEqual([
      { position: 0, name: 'Push', exerciseCount: 1 },
      { position: 1, name: 'Pull', exerciseCount: 0 },
    ])
  })
})

describe('editorSetForWeek', () => {
  it('uses the template values when the week has no override', () => {
    const resolved = editorSetForWeek(set(), 2, 'kg')
    expect(resolved).toMatchObject({ repMin: 3, repMax: 5, rir: 2, load: 100, overridden: false })
  })

  it('lays the override over the template FIELD BY FIELD', () => {
    // The override names only the load; the rep range must survive it.
    const resolved = editorSetForWeek(
      set({ overrides: [override({ week: 3, suggestedLoadKg: 90 })] }),
      3,
      'kg',
    )
    expect(resolved).toMatchObject({ repMin: 3, repMax: 5, load: 90, overridden: true })
  })

  it('ignores an override belonging to a different week', () => {
    const resolved = editorSetForWeek(
      set({ overrides: [override({ week: 4, suggestedLoadKg: 90 })] }),
      3,
      'kg',
    )
    expect(resolved).toMatchObject({ load: 100, overridden: false })
  })

  it('does not claim an override when every field of the row is cleared', () => {
    const resolved = editorSetForWeek(set({ overrides: [override({ week: 3 })] }), 3, 'kg')
    expect(resolved).toMatchObject({ load: 100, repMin: 3, overridden: false })
  })

  it('converts the load into the display unit', () => {
    expect(editorSetForWeek(set({ suggestedLoadKg: 100 }), 1, 'lb').load).toBeCloseTo(220.5, 1)
  })

  it('keeps a null load null rather than converting it to zero', () => {
    expect(editorSetForWeek(set({ suggestedLoadKg: null }), 1, 'lb').load).toBeNull()
  })
})

describe('editorSetLoadKg', () => {
  it('answers in kg, applying the same override rule the pane uses', () => {
    expect(
      editorSetLoadKg(set({ overrides: [override({ week: 3, suggestedLoadKg: 90 })] }), 3),
    ).toBe(90)
    expect(editorSetLoadKg(set(), 3)).toBe(100)
  })
})

describe('editorDayDetail', () => {
  const day = {
    name: 'Push',
    exercises: [
      { name: 'Bench', sets: [set({ setNumber: 1 }), set({ setNumber: 2 })] },
      { name: 'Dip', sets: [] },
    ],
  }

  it('resolves the day exercises in position order for the selected week', () => {
    const detail = editorDayDetail(day, 1, 2, 'kg')
    expect(detail).not.toBeNull()
    expect(detail?.position).toBe(1)
    expect(detail?.exercises.map((e) => e.position)).toEqual([0, 1])
    expect(detail?.exercises[0].sets.map((s) => s.setNumber)).toEqual([1, 2])
  })

  it('returns null for an unaddressed day rather than substituting a neighbour', () => {
    expect(editorDayDetail(null, null, 1, 'kg')).toBeNull()
    expect(editorDayDetail(day, null, 1, 'kg')).toBeNull()
  })
})
