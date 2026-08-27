import { describe, it, expect } from 'vitest'
import {
  isSettled,
  trainedDayState,
  trainedSeamIndex,
  weekTrainedReport,
  type TrainedDayState,
  type TrainedWorkoutRow,
} from './trained-view'

const at = (iso: string) => new Date(iso)

const row = (patch: Partial<TrainedWorkoutRow> = {}): TrainedWorkoutRow => ({
  programDayId: 'day-1',
  programWeek: 3,
  startedAt: at('2026-08-01T09:00:00Z'),
  completedAt: null,
  ...patch,
})

describe('trainedDayState', () => {
  it('reads a completed session as Done', () => {
    expect(trainedDayState([row({ completedAt: at('2026-08-01T10:30:00Z') })], false)).toBe('done')
  })

  it('reads a started-but-unfinished session as In progress', () => {
    expect(trainedDayState([row()], false)).toBe('in-progress')
  })

  it('says nothing for an untouched day in the current or a future week', () => {
    expect(trainedDayState([], false)).toBeNull()
  })

  it('says Skipped only once the week is PAST', () => {
    expect(trainedDayState([], true)).toBe('skipped')
  })

  it('prefers the completed row when a day carries both (resolveDayState)', () => {
    const state = trainedDayState(
      [
        row(),
        row({ startedAt: at('2026-08-01T07:00:00Z'), completedAt: at('2026-08-01T08:00:00Z') }),
      ],
      false,
    )
    expect(state).toBe('done')
  })
})

describe('isSettled', () => {
  it('counts an IN-PROGRESS session as settled, like a completed one', () => {
    // The fact a naive implementation gets wrong: the sets were written at
    // start time, and resuming returns them untouched.
    expect(isSettled('in-progress')).toBe(true)
    expect(isSettled('done')).toBe(true)
  })

  it('does not count an untouched or skipped day as settled', () => {
    expect(isSettled(null)).toBe(false)
    expect(isSettled('skipped')).toBe(false)
  })
})

describe('weekTrainedReport', () => {
  it('reports a count for a mixed week', () => {
    const states: TrainedDayState[] = ['done', 'in-progress', null, null]
    expect(weekTrainedReport(states)).toEqual({ trained: 2, total: 4, allTrained: false })
  })

  it('reports every day settled as allTrained', () => {
    expect(weekTrainedReport(['done', 'done'])).toEqual({
      trained: 2,
      total: 2,
      allTrained: true,
    })
  })

  it('does not call a program with no days trained', () => {
    expect(weekTrainedReport([])).toEqual({ trained: 0, total: 0, allTrained: false })
  })

  it('does not count a skipped day as trained', () => {
    expect(weekTrainedReport(['skipped', 'skipped'])).toMatchObject({
      trained: 0,
      allTrained: false,
    })
  })
})

describe('trainedSeamIndex', () => {
  it('puts the seam before the first editable row when settled days are a prefix', () => {
    expect(trainedSeamIndex(['done', 'in-progress', null, null])).toBe(2)
  })

  it('draws no seam when nothing is settled yet', () => {
    expect(trainedSeamIndex([null, null])).toBeNull()
    expect(trainedSeamIndex(['skipped', null])).toBeNull()
  })

  it('draws no seam when everything is settled', () => {
    expect(trainedSeamIndex(['done', 'done'])).toBeNull()
  })

  it('draws no seam when the settled days are NOT contiguous', () => {
    // Day 1 done, day 2 untrained, day 3 done: no single rule can say
    // "everything below is editable" without lying about day 3.
    expect(trainedSeamIndex(['done', null, 'done'])).toBeNull()
  })

  it('draws no seam for an empty program', () => {
    expect(trainedSeamIndex([])).toBeNull()
  })
})
