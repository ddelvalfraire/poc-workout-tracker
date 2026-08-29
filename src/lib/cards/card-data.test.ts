import { describe, it, expect, vi } from 'vitest'

// card-data reuses lib/trophies' labels, whose module graph reaches the db
// client + push sender — mock the same boundary as lib/trophies.test.ts.
vi.mock('@/db/trophies', () => ({
  listTrophies: vi.fn(async () => []),
  stampTrophies: vi.fn(async () => []),
  workoutFinishFacts: vi.fn(async () => null),
  countCompletedWorkouts: vi.fn(async () => 0),
  lifetimeTonnageKg: vi.fn(async () => 0),
  activeProgramRef: vi.fn(async () => null),
}))
vi.mock('@/db/exercise-stats', () => ({
  getExerciseStats: vi.fn(async () => null),
  listLoggedExercises: vi.fn(async () => []),
}))
vi.mock('@/db/goals', () => ({
  activeScheduledWeekdays: vi.fn(async () => []),
  completedWorkoutTimes: vi.fn(async () => []),
}))
vi.mock('@/db/programs', () => ({
  programWeekState: vi.fn(async () => ({ currentWeek: 1, blockComplete: false })),
}))
vi.mock('@/lib/push', () => ({
  sendPushToUser: vi.fn(async () => ({ configured: true, sent: 1, pruned: 0, failed: 0 })),
}))

import type { ExerciseAllTimeStats, ExerciseTrendPoint } from '@/db/exercise-stats'
import type { TrophyRow } from '@/db/trophies'
import { createTranslator } from 'next-intl'
import en from '../../../messages/en.json'
import { TROPHY_KINDS } from '@/lib/goals/trophy-kinds'
import {
  formatCardMonthYear,
  isTrophyKind,
  prCardData,
  sparklinePath,
  trendCardData,
  trophyCardData,
  workoutCardData,
  type RenderTrophyMessage,
  type WorkoutCardInput,
} from './card-data'

function trophyRow(overrides: Partial<TrophyRow> = {}): TrophyRow {
  return {
    id: 't1',
    kind: 'club_squat_315',
    achievedAt: new Date('2026-08-15T12:00:00Z'),
    context: { e1rmKg: 143.79 }, // 317 lb at entry precision
    ...overrides,
  }
}

function makeStats(overrides: {
  name?: string
  bestE1rm?: ExerciseAllTimeStats['records']['bestE1rm']
  trend?: ExerciseTrendPoint[]
}): ExerciseAllTimeStats {
  return {
    exercise: {
      wgerExerciseId: 615,
      source: 'wger',
      name: overrides.name ?? 'Squats',
      loggingType: 'weight_reps',
    },
    totalSessions: 2,
    totalCompletedSets: 6,
    records: {
      bestE1rm: overrides.bestE1rm ?? null,
      heaviestLoadKg: null,
      mostReps: null,
      bestSessionVolumeKg: null,
    },
    trend: overrides.trend ?? [],
  }
}

describe('formatCardMonthYear', () => {
  it('renders the coarse month/year only — cards leave the app', () => {
    expect(formatCardMonthYear(new Date('2026-08-15T12:00:00Z'))).toBe('Aug 2026')
  })
})

describe('isTrophyKind', () => {
  it('accepts every defined kind and rejects garbage', () => {
    expect(isTrophyKind('club_squat_315')).toBe(true)
    expect(isTrophyKind('tonnage_2m')).toBe(true)
    expect(isTrophyKind('club_squat_999')).toBe(false)
    expect(isTrophyKind('')).toBe(false)
  })
})

describe('trophyCardData', () => {
  // The REAL catalog, not a stub: a card is an image, so an unresolved key
  // would ship as a key path burned into a PNG the user then shares.
  const t = createTranslator({ locale: 'en', messages: en, namespace: 'Trophies' })
  const render: RenderTrophyMessage = (message) => t(message.key, message.values)

  it('returns null for an unknown kind param', () => {
    expect(trophyCardData([trophyRow()], 'not_a_kind', 'lb', render)).toBeNull()
  })

  it('returns null when the kind is real but not earned', () => {
    expect(trophyCardData([trophyRow()], 'club_bench_225', 'lb', render)).toBeNull()
  })

  it('builds title + fact + coarse date in lb', () => {
    expect(trophyCardData([trophyRow()], 'club_squat_315', 'lb', render)).toEqual({
      title: '315 Squat Club',
      context: 'e1RM 317 lb · Aug 2026',
    })
  })

  it('speaks kg for kg users while the club name stays lb-cultured', () => {
    expect(trophyCardData([trophyRow()], 'club_squat_315', 'kg', render)).toEqual({
      title: '315 Squat Club',
      context: 'e1RM 143.79 kg · Aug 2026',
    })
  })

  it('falls back to date-only context for kinds without a recorded number', () => {
    const row = trophyRow({ kind: 'block_complete', context: { workoutId: 'w1' } })
    expect(trophyCardData([row], 'block_complete', 'lb', render)).toEqual({
      title: 'Block Complete',
      context: 'Aug 2026',
    })
  })

  it('never bakes an unresolved key path into a card, for any kind', () => {
    for (const kind of TROPHY_KINDS) {
      const data = trophyCardData([trophyRow({ kind })], kind, 'lb', render)
      expect(data).not.toBeNull()
      expect(`${data?.title} ${data?.context}`).not.toMatch(/Trophies\.[a-zA-Z.]+/)
    }
  })
})

describe('prCardData', () => {
  it('returns null without stats or without an e1RM record', () => {
    expect(prCardData(null, 'lb')).toBeNull()
    expect(prCardData(makeStats({}), 'lb')).toBeNull()
  })

  it('converts the record into the display unit with a coarse date', () => {
    const stats = makeStats({
      bestE1rm: {
        workoutId: 'w1',
        performedAt: new Date('2026-07-04T10:00:00Z'),
        reps: 3,
        weightKg: 137.44,
        e1rm: 143.79,
      },
    })
    expect(prCardData(stats, 'lb')).toEqual({
      exerciseName: 'Squats',
      value: '317',
      unit: 'lb',
      dateText: 'Jul 2026',
    })
    expect(prCardData(stats, 'kg')?.value).toBe('143.79')
  })
})

describe('trendCardData', () => {
  const jun1 = new Date('2026-06-01T10:00:00Z')
  const jul27 = new Date('2026-07-27T10:00:00Z') // 56 days later — 8 weeks

  it('returns null without stats or with fewer than two points', () => {
    expect(trendCardData(null, 'lb')).toBeNull()
    expect(
      trendCardData(
        makeStats({ trend: [{ workoutId: 'w1', performedAt: jun1, e1rm: 142.88 }] }),
        'lb',
      ),
    ).toBeNull()
  })

  it('tells first → best over the weeks between them, display unit', () => {
    const stats = makeStats({
      trend: [
        { workoutId: 'w1', performedAt: jun1, e1rm: 142.88 }, // 315 lb
        { workoutId: 'w2', performedAt: jul27, e1rm: 154.22 }, // 340 lb
      ],
    })
    expect(trendCardData(stats, 'lb')).toEqual({
      exerciseName: 'Squats',
      headline: '315 → 340 lb',
      subline: 'in 8 weeks',
      values: [315, 340],
    })
  })

  it('uses the singular week and a 1-week floor for short spans', () => {
    const stats = makeStats({
      trend: [
        { workoutId: 'w1', performedAt: jun1, e1rm: 142.88 },
        { workoutId: 'w2', performedAt: new Date('2026-06-04T10:00:00Z'), e1rm: 154.22 },
      ],
    })
    expect(trendCardData(stats, 'lb')?.subline).toBe('in 1 week')
  })

  it('spans the whole series when session one was never beaten', () => {
    const stats = makeStats({
      trend: [
        { workoutId: 'w1', performedAt: jun1, e1rm: 154.22 },
        { workoutId: 'w2', performedAt: jul27, e1rm: 142.88 },
      ],
    })
    expect(trendCardData(stats, 'lb')).toEqual({
      exerciseName: 'Squats',
      headline: '340 → 340 lb',
      subline: 'in 8 weeks',
      values: [340, 315],
    })
  })
})

describe('sparklinePath', () => {
  it('returns an empty path for an empty series', () => {
    expect(sparklinePath([], 100, 50)).toBe('')
  })

  it('draws the horizontal midline for a flat series', () => {
    expect(sparklinePath([100, 100], 100, 50)).toBe('M 0 25 L 100 25')
  })

  it('normalizes min→bottom, max→top inside the stroke inset', () => {
    // height 50, inset 6: min y = 44, max y = 6.
    expect(sparklinePath([100, 200], 100, 50)).toBe('M 0 44 L 100 6')
  })

  it('spaces intermediate points evenly across the width', () => {
    expect(sparklinePath([100, 150, 200], 100, 50)).toBe('M 0 44 L 50 25 L 100 6')
  })
})

describe('workoutCardData', () => {
  function workout(over: Partial<WorkoutCardInput> = {}): WorkoutCardInput {
    return {
      name: 'Push Day',
      startedAt: new Date('2026-08-01T18:00:00Z'),
      completedAt: new Date('2026-08-01T18:48:00Z'),
      exercises: [
        { sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 100 }] },
        { sets: [{ reps: 8, weight: 40 }] },
      ],
      ...over,
    }
  }

  it('leads with volume in the display unit, sets and duration as context', () => {
    expect(workoutCardData(workout(), 'kg')).toEqual({
      title: 'Push Day',
      value: '1,320',
      unitLabel: 'kg',
      context: '3 sets · 48 min · Aug 2026',
    })
  })

  it('falls back to the set count when no set carried a load', () => {
    const data = workoutCardData(
      workout({ exercises: [{ sets: [{ reps: 12, weight: null }] }] }),
      'kg',
    )

    expect(data).toMatchObject({ value: '1', unitLabel: 'set' })
    expect(data?.context).toBe('48 min · Aug 2026')
  })

  it('drops an implausible duration and defaults an unnamed session', () => {
    const started = new Date('2026-08-01T18:00:00Z')
    const data = workoutCardData(
      workout({ name: null, startedAt: started, completedAt: started }),
      'kg',
    )

    expect(data?.title).toBe('Workout')
    expect(data?.context).toBe('3 sets · Aug 2026')
  })

  it('is null for a workout still in progress', () => {
    expect(workoutCardData(workout({ completedAt: null }), 'kg')).toBeNull()
  })
})
