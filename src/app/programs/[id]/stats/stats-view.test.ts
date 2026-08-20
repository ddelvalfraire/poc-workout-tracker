import { describe, it, expect } from 'vitest'
import { renderMessageIn } from '../../../../../vitest.intl'
import { MAX_RELIABLE_REPS } from '@/lib/one-rep-max'
import type {
  ExerciseWeekPoint,
  ProgramWeekStats,
  ProgramExercisePRPoint,
  ProgramExerciseProgression,
} from '@/db/program-stats'
import type { MuscleVerdict } from '@/lib/volume-progression'
import {
  blockAdherencePct,
  e1rmSparkline,
  visibleWeeks,
  volumeBarWidthPct,
  volumeTrendSign,
  hasAnyTraining,
  prDeltaKg,
  programVerdict,
  isHighRepEstimate,
  topPRs,
  volumeStatusLabel,
  volumeDriversLine,
  muscleWeekSeries,
  formatCreditedSets,
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

describe('blockAdherencePct', () => {
  it('is the completed/planned percent over weeks before the current one', () => {
    const weeks = [
      week({ week: 1, daysCompleted: 4, plannedDays: 4 }),
      week({ week: 2, daysCompleted: 2, plannedDays: 4 }),
      week({ week: 3, daysCompleted: 1, plannedDays: 4 }), // current — excluded
    ]

    expect(blockAdherencePct(weeks, 3)).toBe(75)
  })

  it('is null with nothing behind you (week 1, or a dayless program)', () => {
    expect(blockAdherencePct(zeroedBlock(4), 1)).toBeNull()
    expect(blockAdherencePct([week({ week: 1, plannedDays: 0 })], 2)).toBeNull()
  })
})

describe('volumeTrendSign', () => {
  it('signs the last two trained prior weeks, skipping untrained gaps', () => {
    const weeks = [
      week({ week: 1, daysStarted: 2, tonnageKg: 4000 }),
      week({ week: 2 }), // untrained — skipped, not a crash to zero
      week({ week: 3, daysStarted: 2, tonnageKg: 5000 }),
      week({ week: 4, daysStarted: 1, tonnageKg: 100 }), // current — excluded
    ]

    expect(volumeTrendSign(weeks, 4)).toBe(1)
  })

  it('signs a decline as −1', () => {
    const weeks = [
      week({ week: 1, daysStarted: 2, tonnageKg: 5000 }),
      week({ week: 2, daysStarted: 2, tonnageKg: 4000 }),
    ]

    expect(volumeTrendSign(weeks, 3)).toBe(-1)
  })

  it('is null with fewer than two trained prior weeks', () => {
    expect(volumeTrendSign([week({ week: 1, daysStarted: 1, tonnageKg: 4000 })], 2)).toBeNull()
  })
})

describe('programVerdict', () => {
  const trainedWeeks = [
    week({ week: 1, daysStarted: 4, daysCompleted: 4, plannedDays: 4, tonnageKg: 4000 }),
    week({ week: 2, daysStarted: 3, daysCompleted: 3, plannedDays: 4, tonnageKg: 5000 }),
  ]
  /** The hero as the page renders it: both descriptors through en.json. */
  const hero = (
    weeks: Parameters<typeof programVerdict>[0],
    currentWeek: number,
    prCount: number,
  ) => {
    const verdict = programVerdict(weeks, currentWeek, prCount)
    return {
      headline: renderMessageIn('ProgramStats', verdict.headline),
      context: renderMessageIn('ProgramStats', verdict.context),
    }
  }

  it('picks the gains branch and carries count, adherence ratio and trend', () => {
    expect(programVerdict(trainedWeeks, 3, 2)).toEqual({
      headline: { key: 'verdict.headlineStronger' },
      context: {
        key: 'verdict.contextStronger',
        // A RATIO, not a whole percent: ICU's `number, percent` places the
        // sign, so 0.88 is what the message wants.
        values: { lifts: 2, adherence: 0.88, trend: 'up' },
      },
    })
  })

  it('celebrates gains with count, adherence, and trend in the context', () => {
    expect(hero(trainedWeeks, 3, 2)).toEqual({
      headline: 'Getting stronger.',
      context: '2 lifts up this block · 88% of planned days trained · volume up week over week',
    })
  })

  // Singular and plural separately: the lift count was hand-pluralized before.
  it('agrees the lift count at one', () => {
    const oneWeek = [week({ week: 1, daysStarted: 4, daysCompleted: 4, plannedDays: 4 })]
    expect(hero(oneWeek, 2, 1).context).toBe('1 lift up this block · 100% of planned days trained')
  })

  it('credits consistency without gains (singular lift handled elsewhere)', () => {
    expect(programVerdict(trainedWeeks, 3, 0).headline).toEqual({ key: 'verdict.headlineSteady' })
    expect(hero(trainedWeeks, 3, 0)).toEqual({
      headline: 'Showing up.',
      context: '88% of planned days trained · volume up week over week',
    })
  })

  it('falls back to early days before any completed week', () => {
    expect(programVerdict(zeroedBlock(5), 1, 0)).toEqual({
      headline: { key: 'verdict.headlineEarly' },
      context: { key: 'verdict.contextEarly' },
    })
    expect(hero(zeroedBlock(5), 1, 0)).toEqual({
      headline: 'Early days.',
      context: 'The block picture builds as you train.',
    })
  })

  it('omits the trend clause when there is no trend to sign', () => {
    const oneWeek = [week({ week: 1, daysStarted: 4, daysCompleted: 4, plannedDays: 4 })]

    expect(programVerdict(oneWeek, 2, 1).context.values).toMatchObject({ trend: 'flat' })
    expect(hero(oneWeek, 2, 1).context).toBe(
      '1 lift up this block · 100% of planned days trained',
    )
  })

  it('renders the adherence as an Intl percentage, not a hand-written sign', () => {
    const expected = new Intl.NumberFormat('en', { style: 'percent' }).format(0.88)
    expect(hero(trainedWeeks, 3, 2).context).toContain(expected)
  })

  it('leaves no unresolved key path in either line', () => {
    for (const args of [
      [trainedWeeks, 3, 2],
      [trainedWeeks, 3, 0],
      [zeroedBlock(5), 1, 0],
    ] as const) {
      const rendered = hero(args[0], args[1], args[2])
      expect(rendered.headline).not.toMatch(/ProgramStats\.[a-zA-Z.]+/)
      expect(rendered.context).not.toMatch(/ProgramStats\.[a-zA-Z.]+/)
    }
  })
})

describe('e1rmSparkline', () => {
  const point = (week: number, e1rm: number | null): ExerciseWeekPoint => ({
    week,
    best: e1rm === null ? null : { kind: 'e1rm', index: 0, reps: 5, weightKg: 100, e1rm },
    completedSets: 3,
  })

  it('is null with fewer than two e1rm-scorable weeks', () => {
    expect(e1rmSparkline([point(1, 100)], 120, 32)).toBeNull()
    expect(e1rmSparkline([point(1, 100), point(2, null)], 120, 32)).toBeNull()
  })

  it('plots week on x (time-true), e1rm min-max on y, inside the inset', () => {
    const spark = e1rmSparkline([point(1, 100), point(2, 110), point(4, 120)], 120, 32)

    expect(spark).not.toBeNull()
    // Week 2 sits 1/3 across the week-1..4 span, not halfway.
    expect(spark!.points.map((p) => p.x)).toEqual([3, 41, 117])
    expect(spark!.points[0].y).toBe(29) // min → bottom inset
    expect(spark!.points[2].y).toBe(3) // max → top inset
    expect(spark!.path).toBe('M 3 29 L 41 16 L 117 3')
  })

  it('marks only NEW running maxes, never the baseline', () => {
    const spark = e1rmSparkline(
      [point(1, 100), point(2, 110), point(3, 105), point(4, 120)],
      120,
      32,
    )

    expect(spark!.points.map((p) => p.isRunningMax)).toEqual([false, true, false, true])
  })

  it('draws the midline for a flat series', () => {
    const spark = e1rmSparkline([point(1, 100), point(2, 100)], 120, 32)

    expect(spark!.points.every((p) => p.y === 16)).toBe(true)
  })
})

describe('volume status view helpers', () => {
  const verdict = (
    status: MuscleVerdict['status'],
    drivers: string[] = [],
  ): MuscleVerdict => ({ group: 'Chest', status, drivers, candidate: null })

  const render = (message: Parameters<typeof renderMessageIn>[1]) =>
    renderMessageIn('ProgramStats', message)

  it('picks one status key per verdict', () => {
    expect(volumeStatusLabel('increase')).toEqual({ key: 'muscle.statusIncrease' })
    expect(volumeStatusLabel('hold')).toEqual({ key: 'muscle.statusHold' })
    expect(volumeStatusLabel('on-track')).toEqual({ key: 'muscle.statusOnTrack' })
  })

  it('status words per the chip contract', () => {
    expect(render(volumeStatusLabel('increase'))).toBe('+1 earned')
    expect(render(volumeStatusLabel('hold'))).toBe('hold')
    expect(render(volumeStatusLabel('on-track'))).toBe('on track')
  })

  it('passes the driver NAMES as an argument — exercise names are never copy', () => {
    expect(volumeDriversLine(verdict('increase', ['Bench Press']))).toEqual({
      key: 'muscle.driversIncrease',
      values: { names: 'Bench Press' },
    })
    expect(volumeDriversLine(verdict('hold', ['Squat', 'Leg Press']))).toEqual({
      key: 'muscle.driversHold',
      values: { names: 'Squat, Leg Press' },
    })
  })

  it('drivers line names the movements; on-track stays silent', () => {
    expect(render(volumeDriversLine(verdict('increase', ['Bench Press']))!)).toBe(
      'Bench Press beat top of range 2 weeks running',
    )
    expect(render(volumeDriversLine(verdict('hold', ['Squat', 'Leg Press']))!)).toBe(
      'Squat, Leg Press stalled — hold volume while recovery catches up',
    )
    expect(volumeDriversLine(verdict('on-track'))).toBe(null)
  })

  it('muscleWeekSeries keeps zero weeks and honors the trend limit', () => {
    const weeks = [
      { week: 1, groups: [{ group: 'Chest' as const, sets: 6 }] },
      { week: 2, groups: [] },
      { week: 3, groups: [{ group: 'Chest' as const, sets: 7.5 }] },
    ]
    expect(muscleWeekSeries(weeks, 'Chest')).toEqual([
      { week: 1, sets: 6 },
      { week: 2, sets: 0 },
      { week: 3, sets: 7.5 },
    ])
    expect(muscleWeekSeries(weeks, 'Chest', 2).map((p) => p.week)).toEqual([2, 3])
  })

  it('formatCreditedSets renders halves honestly and integers bare', () => {
    expect(formatCreditedSets(7)).toBe('7')
    expect(formatCreditedSets(7.5)).toBe('7.5')
  })

  it('formatCreditedSets is Intl, so the decimal separator follows the locale', () => {
    expect(formatCreditedSets(7.5, 'en')).toBe(
      new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
        7.5,
      ),
    )
  })
})
