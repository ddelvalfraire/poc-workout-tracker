import { describe, it, expect } from 'vitest'
import {
  editorDayDetail,
  editorDays,
  editorLoggedExercises,
  editorSetForWeek,
  editorSetLoadKg,
  editorWeeks,
  type SourceLoggedExercise,
  type SourceLoggedSet,
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
  const days = [
    { name: 'Push', exercises: [{ name: 'Bench', sets: [] }] },
    { name: 'Pull', exercises: [] },
  ]

  it('numbers days by position, counts exercises, and carries trained state', () => {
    expect(editorDays(days, ['done', null])).toEqual([
      { position: 0, name: 'Push', exerciseCount: 1, trained: 'done' },
      { position: 1, name: 'Pull', exerciseCount: 0, trained: null },
    ])
  })

  it('reads a missing state as untouched rather than inventing trained', () => {
    expect(editorDays(days, []).map((day) => day.trained)).toEqual([null, null])
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

  it('defaults to no trained state and no session, so a draft claims neither', () => {
    const detail = editorDayDetail(day, 0, 1, 'kg')
    expect(detail).toMatchObject({ trained: null, session: null })
  })

  it('carries the trained state and session it is given', () => {
    const session = {
      href: '/workout/w1',
      completedSetCount: 10,
      setCount: 12,
      volume: 4820,
      exercises: [],
    }
    expect(editorDayDetail(day, 0, 1, 'kg', 'in-progress', session)).toMatchObject({
      trained: 'in-progress',
      session,
    })
  })

  it('returns null for an unaddressed day rather than substituting a neighbour', () => {
    expect(editorDayDetail(null, null, 1, 'kg')).toBeNull()
    expect(editorDayDetail(day, null, 1, 'kg')).toBeNull()
  })
})

describe('editorLoggedExercises', () => {
  const logged = (patch: Partial<SourceLoggedSet> = {}): SourceLoggedSet => ({
    setNumber: 1,
    completed: true,
    reps: 8,
    weight: 80,
    metricMode: 'reps_weight',
    durationSec: null,
    distanceM: null,
    prescribedLoadKg: 80,
    prescribedRepMin: 8,
    ...patch,
  })

  const exercise = (patch: Partial<SourceLoggedExercise> = {}): SourceLoggedExercise => ({
    name: 'Barbell Row',
    loggingType: 'weight_reps',
    sets: [logged()],
    ...patch,
  })

  it('carries the session\'s own names and order, not the plan\'s', () => {
    // The plan may have been reordered or a lift swapped since the session
    // started. Aligning to it would put one movement's numbers under another
    // movement's name.
    const rows = editorLoggedExercises([exercise(), exercise({ name: 'Lat Pulldown' })])
    expect(rows.map((row) => row.name)).toEqual(['Barbell Row', 'Lat Pulldown'])
    expect(rows.map((row) => row.position)).toEqual([0, 1])
  })

  it('does not call a set diverged when it went exactly as prescribed', () => {
    // Drawing the struck-through target on every row would bury the handful
    // that actually moved, which is the whole signal.
    expect(editorLoggedExercises([exercise()])[0].sets[0].diverged).toBe(false)
  })

  it('marks a set diverged when the load moved', () => {
    const rows = editorLoggedExercises([exercise({ sets: [logged({ weight: 60 })] })])
    expect(rows[0].sets[0]).toMatchObject({
      diverged: true,
      weight: 60,
      prescribedWeight: 80,
    })
  })

  it('marks a set diverged when the reps moved', () => {
    const rows = editorLoggedExercises([exercise({ sets: [logged({ reps: 5 })] })])
    expect(rows[0].sets[0]).toMatchObject({ diverged: true, reps: 5, prescribedReps: 8 })
  })

  it('never claims a prescription for a set that had none', () => {
    // Ad-hoc sets, and everything logged before the snapshot columns existed.
    // Null is not a target of zero, and a struck-through blank would invent one.
    const rows = editorLoggedExercises([
      exercise({ sets: [logged({ prescribedLoadKg: null, prescribedRepMin: null })] }),
    ])
    expect(rows[0].sets[0]).toMatchObject({
      diverged: false,
      prescribedReps: null,
      prescribedWeight: null,
    })
  })

  it('diverges on a half-prescribed set where the prescribed half moved', () => {
    const rows = editorLoggedExercises([
      exercise({ sets: [logged({ prescribedLoadKg: null, reps: 5 })] }),
    ])
    expect(rows[0].sets[0].diverged).toBe(true)
  })

  it('keeps an uncompleted set rather than dropping it from the log', () => {
    // A set that was never logged is a fact about the session too, and
    // silently omitting it would make the log disagree with the set counts
    // shown right above it.
    const rows = editorLoggedExercises([
      exercise({ sets: [logged({ completed: false, reps: null, weight: null })] }),
    ])
    expect(rows[0].sets[0]).toMatchObject({ completed: false, reps: null })
  })

  it("carries the exercise's logging type, which decides how weight reads", () => {
    const rows = editorLoggedExercises([exercise({ loggingType: 'weighted_bodyweight' })])
    expect(rows[0].loggingType).toBe('weighted_bodyweight')
  })
})
