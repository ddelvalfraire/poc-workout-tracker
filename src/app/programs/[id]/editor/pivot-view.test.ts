import { describe, it, expect } from 'vitest'
import { pivotCell, pivotRows } from './pivot-view'
import type { SourceExercise, SourceOverride, SourceSet } from './editor-view'

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
  repMin: 8,
  repMax: 8,
  rir: 2,
  rpe: null,
  suggestedLoadKg: 80,
  overrides: [],
  ...patch,
})

const exercise = (patch: Partial<SourceExercise> = {}): SourceExercise => ({
  name: 'Barbell Row',
  sets: [set({ setNumber: 1 }), set({ setNumber: 2 }), set({ setNumber: 3 })],
  ...patch,
})

describe('pivotCell', () => {
  it('states the shared numbers when every counted set agrees', () => {
    expect(pivotCell(exercise(), 1, 'kg')).toMatchObject({
      week: 1,
      setCount: 3,
      repMin: 8,
      repMax: 8,
      repsUniform: true,
      loadLow: 80,
      loadHigh: 80,
      pinned: false,
    })
  })

  it('excludes warmups from the count and from the load', () => {
    // A warmup at 40 alongside working sets at 80 must not drag the cell's
    // load toward the empty bar, nor inflate the count read as volume.
    const cell = pivotCell(
      exercise({
        sets: [
          set({ setNumber: 1, setType: 'warmup', suggestedLoadKg: 40, repMin: 10, repMax: 10 }),
          set({ setNumber: 2 }),
          set({ setNumber: 3 }),
        ],
      }),
      1,
      'kg',
    )
    expect(cell.setCount).toBe(2)
    expect(cell.loadLow).toBe(80)
    expect(cell.repsUniform).toBe(true)
  })

  it('prints a count rather than a rep target when the counted sets disagree', () => {
    const cell = pivotCell(
      exercise({
        sets: [set({ setNumber: 1 }), set({ setNumber: 2, repMin: 5, repMax: 5 })],
      }),
      1,
      'kg',
    )
    expect(cell.repsUniform).toBe(false)
    expect(cell.repMin).toBeNull()
    expect(cell.repMax).toBeNull()
    expect(cell.setCount).toBe(2)
  })

  it('reports a spread rather than one number when the loads disagree', () => {
    const cell = pivotCell(
      exercise({
        sets: [
          set({ setNumber: 1, suggestedLoadKg: 60 }),
          set({ setNumber: 2, suggestedLoadKg: 80 }),
          set({ setNumber: 3, suggestedLoadKg: 70 }),
        ],
      }),
      1,
      'kg',
    )
    expect(cell.loadLow).toBe(60)
    expect(cell.loadHigh).toBe(80)
  })

  it('reports no load at all rather than zero when nothing names one', () => {
    const cell = pivotCell(exercise({ sets: [set({ suggestedLoadKg: null })] }), 1, 'kg')
    expect(cell.loadLow).toBeNull()
    expect(cell.loadHigh).toBeNull()
  })

  it('keeps an all-warmup exercise in the grid as a zero-count cell', () => {
    const cell = pivotCell(exercise({ sets: [set({ setType: 'warmup' })] }), 1, 'kg')
    expect(cell.setCount).toBe(0)
    expect(cell.loadLow).toBeNull()
  })

  it('lays the week override over the template per field', () => {
    const cell = pivotCell(
      exercise({
        sets: [set({ overrides: [override({ week: 3, suggestedLoadKg: 90 })] })],
      }),
      3,
      'kg',
    )
    // The load moved; the reps came from the template, because the override
    // named no reps and a row-wise merge would have nulled them.
    expect(cell.loadLow).toBe(90)
    expect(cell.repMin).toBe(8)
    expect(cell.pinned).toBe(true)
  })

  it('leaves other weeks alone and unpinned', () => {
    const withPin = exercise({
      sets: [set({ overrides: [override({ week: 3, suggestedLoadKg: 90 })] })],
    })
    expect(pivotCell(withPin, 2, 'kg')).toMatchObject({ loadLow: 80, pinned: false })
  })

  it('does not call a week pinned when its override row supplies nothing', () => {
    // An emptied override leaves the row behind. It changes no value, so it
    // must not put a mark on the grid claiming the user wrote something.
    const cell = pivotCell(
      exercise({ sets: [set({ overrides: [override({ week: 3 })] })] }),
      3,
      'kg',
    )
    expect(cell.pinned).toBe(false)
  })

  it('marks the week pinned when only a warmup was edited', () => {
    // The warmup is excluded from the SUMMARY but not from the question "did
    // you touch this week" — otherwise the one edit made leaves no trace.
    const cell = pivotCell(
      exercise({
        sets: [
          set({ setNumber: 1, setType: 'warmup', overrides: [override({ week: 2, repMax: 12 })] }),
          set({ setNumber: 2 }),
        ],
      }),
      2,
      'kg',
    )
    expect(cell.pinned).toBe(true)
    expect(cell.setCount).toBe(1)
  })

  it('converts the load into the display unit', () => {
    expect(pivotCell(exercise(), 1, 'lb').loadLow).toBeGreaterThan(170)
  })

  it('compares loads in kg, so a display rounding step cannot invent a spread', () => {
    // Two sets at the same kg must read as ONE number in pounds too, however
    // the conversion rounds.
    const cell = pivotCell(
      exercise({ sets: [set({ setNumber: 1 }), set({ setNumber: 2 })] }),
      1,
      'lb',
    )
    expect(cell.loadLow).toBe(cell.loadHigh)
  })
})

describe('pivotRows', () => {
  it('renders one row per exercise and one cell per listed week', () => {
    const rows = pivotRows([exercise(), exercise({ name: 'Lat Pulldown' })], [1, 2, 3], 'kg')
    expect(rows.map((row) => row.name)).toEqual(['Barbell Row', 'Lat Pulldown'])
    expect(rows.map((row) => row.position)).toEqual([0, 1])
    expect(rows[0].cells.map((cell) => cell.week)).toEqual([1, 2, 3])
  })

  it('renders the weeks it is given, including ones past the block', () => {
    // The caller passes `editorWeeks`, which keeps trained weeks above a
    // shrunken `mesocycleWeeks`. The grid must not re-derive the range and
    // drop them.
    const rows = pivotRows([exercise()], [1, 2, 3, 4, 5, 6], 'kg')
    expect(rows[0].cells.map((cell) => cell.week)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('has no rows for a day with no exercises', () => {
    expect(pivotRows([], [1, 2], 'kg')).toEqual([])
  })
})
