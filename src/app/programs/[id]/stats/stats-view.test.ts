import { describe, it, expect } from 'vitest'
import { MAX_RELIABLE_REPS } from '@/lib/one-rep-max'
import type {
  ProgramWeekStats,
  ProgramExercisePRPoint,
  ProgramExerciseProgression,
} from '@/db/program-stats'
import {
  visibleWeeks,
  volumeBarWidthPct,
  hasAnyTraining,
  prDeltaKg,
  isHighRepEstimate,
  topPRs,
} from './stats-view'

function week(over: Partial<ProgramWeekStats> = {}): ProgramWeekStats {
  return {
    week: 1,
    daysStarted: 0,
    daysCompleted: 0,
    plannedDays: 5,
    completedSets: 0,
    tonnageKg: 0,
    ...over,
  }
}

/** Materialized 1..n block of zeroed weeks, matching the data layer's shape. */
function zeroedBlock(n: number): ProgramWeekStats[] {
  return Array.from({ length: n }, (_, i) => week({ week: i + 1 }))
}

describe('visibleWeeks', () => {
  it('trims trailing all-zero future weeks down to the current week', () => {
    const weeks = zeroedBlock(7)

    expect(visibleWeeks(weeks, 2)).toHaveLength(2)
  })

  it('keeps trailing weeks that carry data past the current week', () => {
    const weeks = zeroedBlock(7)
    weeks[4] = week({ week: 5, daysStarted: 1, completedSets: 3 })

    expect(visibleWeeks(weeks, 2)).toHaveLength(5)
  })

  it('never trims below the current week even when only week 1 has data', () => {
    const weeks = zeroedBlock(7)
    weeks[0] = week({ week: 1, daysStarted: 2, daysCompleted: 2, completedSets: 10 })

    expect(visibleWeeks(weeks, 3)).toHaveLength(3)
  })

  it('returns empty for an empty weeks array', () => {
    expect(visibleWeeks([], 1)).toEqual([])
  })

  it('treats a started-but-setless week as data (still shows)', () => {
    const weeks = zeroedBlock(4)
    weeks[3] = week({ week: 4, daysStarted: 1 })

    expect(visibleWeeks(weeks, 1)).toHaveLength(4)
  })

  it('does not mutate the input array', () => {
    const weeks = zeroedBlock(7)
    const before = weeks.map((w) => ({ ...w }))

    visibleWeeks(weeks, 2)

    expect(weeks).toEqual(before)
    expect(weeks).toHaveLength(7)
  })
})

describe('volumeBarWidthPct', () => {
  it('returns 0 when the block max is 0 (never NaN or Infinity)', () => {
    expect(volumeBarWidthPct(0, 0)).toBe(0)
  })

  it('returns 100 at the block max', () => {
    expect(volumeBarWidthPct(1000, 1000)).toBe(100)
  })

  it('scales proportionally, rounded to a whole percent', () => {
    expect(volumeBarWidthPct(500, 1000)).toBe(50)
    expect(volumeBarWidthPct(333, 1000)).toBe(33)
  })
})

describe('prDeltaKg', () => {
  const point = (over: Partial<ProgramExercisePRPoint> = {}): ProgramExercisePRPoint => ({
    week: 1,
    reps: 8,
    e1rm: 113,
    ...over,
  })

  it('is the best-minus-baseline e1rm gain', () => {
    const pr = { baseline: point({ e1rm: 113 }), best: point({ week: 3, e1rm: 130 }) }

    expect(prDeltaKg(pr)).toBe(17)
  })

  it('is 0 when baseline and best are the same single week', () => {
    const only = point()

    expect(prDeltaKg({ baseline: only, best: only })).toBe(0)
  })
})

describe('isHighRepEstimate', () => {
  it('is false at exactly MAX_RELIABLE_REPS and true just past it', () => {
    expect(isHighRepEstimate({ week: 1, reps: MAX_RELIABLE_REPS, e1rm: 100 })).toBe(false)
    expect(isHighRepEstimate({ week: 1, reps: MAX_RELIABLE_REPS + 1, e1rm: 100 })).toBe(true)
  })
})

describe('topPRs', () => {
  function exercise(
    name: string,
    pr: { baselineE1rm: number; bestE1rm: number } | null,
  ): ProgramExerciseProgression {
    return {
      wgerExerciseId: name.length, // synthetic, uniqueness irrelevant here
      source: 'wger',
      name,
      loggingType: 'weight_reps',
      weeks: [],
      pr:
        pr === null
          ? null
          : {
              baseline: { week: 1, reps: 8, e1rm: pr.baselineE1rm },
              best: { week: 3, reps: 5, e1rm: pr.bestE1rm },
            },
    }
  }

  it('sorts gains descending by delta', () => {
    const list = [
      exercise('Row', { baselineE1rm: 80, bestE1rm: 85 }), // +5
      exercise('Bench', { baselineE1rm: 113, bestE1rm: 130 }), // +17
      exercise('Squat', { baselineE1rm: 140, bestE1rm: 149 }), // +9
    ]

    expect(topPRs(list, 3).map((e) => e.name)).toEqual(['Bench', 'Squat', 'Row'])
  })

  it('filters out null-pr and zero-delta exercises (only real gains rank)', () => {
    const list = [
      exercise('Curl', null),
      exercise('Press', { baselineE1rm: 60, bestE1rm: 60 }), // single-week baseline, delta 0
      exercise('Deadlift', { baselineE1rm: 180, bestE1rm: 190 }),
    ]

    expect(topPRs(list, 3).map((e) => e.name)).toEqual(['Deadlift'])
  })

  it('respects the count cap', () => {
    const list = Array.from({ length: 5 }, (_, i) =>
      exercise(`Lift ${i}`, { baselineE1rm: 100, bestE1rm: 101 + i }),
    )

    expect(topPRs(list, 3)).toHaveLength(3)
  })

  it('returns empty for empty input', () => {
    expect(topPRs([], 3)).toEqual([])
  })
})

describe('hasAnyTraining', () => {
  it('is false for a fully zeroed block (drives the whole-page empty state)', () => {
    expect(hasAnyTraining(zeroedBlock(7))).toBe(false)
  })

  it('is true when any week has a started day', () => {
    const weeks = zeroedBlock(3)
    weeks[1] = week({ week: 2, daysStarted: 1 })

    expect(hasAnyTraining(weeks)).toBe(true)
  })

  it('is false for an empty weeks array', () => {
    expect(hasAnyTraining([])).toBe(false)
  })
})
