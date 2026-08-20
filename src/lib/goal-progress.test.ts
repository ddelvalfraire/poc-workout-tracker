import { describe, it, expect } from 'vitest'
import {
  bodyweightRemainingKg,
  goalLabel,
  goalTension,
  isBodyweightAchieved,
  isConsistencyAchieved,
  isStrengthAchieved,
  paceProjection,
  paceVsDeadline,
  sortGoalsByTension,
  streakWeekTicks,
  strengthPercent,
  weeklyStreak,
  type WeekTickState,
} from './goal-progress'

/**
 * Streak truth table. Fixed calendar (runtime tz, Sunday-first weeks):
 *   current week  Sun Jul 26 – Sat Aug 1, 2026 ("now" = Thu Jul 30 unless said)
 *   week -1       Jul 19–25   week -2  Jul 12–18   week -3  Jul 5–11
 * Schedule Mon/Wed/Fri = [1, 3, 5]. Mon Jul 27, Wed Jul 29; Mon 20, Wed 22,
 * Fri 24; Mon 13, Wed 15, Fri 17; Mon 6, Wed 8, Fri 10.
 */
const at = (day: string) => new Date(`${day}T18:00:00`)
const THU = at('2026-07-30') // getDay() === 4
const MWF = [1, 3, 5]

function streak(
  completions: Date[],
  allowedMissesPerWeek: number,
  now: Date = THU,
  scheduledWeekdays: readonly number[] = MWF,
): number {
  return weeklyStreak({ scheduledWeekdays, completions, allowedMissesPerWeek, now })
}

describe('weeklyStreak — schedule presence', () => {
  it('returns 0 with no scheduled weekdays (nothing to adhere to)', () => {
    expect(streak([at('2026-07-27'), at('2026-07-29')], 1, THU, [])).toBe(0)
  })

  it('ignores junk weekday values; all-junk behaves as unscheduled', () => {
    expect(streak([at('2026-07-27')], 1, THU, [7, -1, 2.5])).toBe(0)
  })
})

describe('weeklyStreak — grace 0 (strict)', () => {
  it('counts a fully-trained past week plus the on-track current week', () => {
    const completions = [
      at('2026-07-20'), at('2026-07-22'), at('2026-07-24'), // week -1 perfect
      at('2026-07-27'), at('2026-07-29'), // current: Mon+Wed trained, Fri not yet due
    ]
    expect(streak(completions, 0)).toBe(2)
  })

  it('breaks on a past week with one miss', () => {
    const completions = [
      at('2026-07-20'), at('2026-07-22'), // week -1: Fri missed
      at('2026-07-27'), at('2026-07-29'),
    ]
    expect(streak(completions, 0)).toBe(1) // current week only
  })

  it('kills the streak when the current week is already unsatisfiable', () => {
    const completions = [
      at('2026-07-20'), at('2026-07-22'), at('2026-07-24'), // week -1 perfect
      at('2026-07-27'), // current: Wed (already elapsed by Thu) missed
    ]
    expect(streak(completions, 0)).toBe(0)
  })
})

describe('weeklyStreak — grace 1 (default) and 2', () => {
  it('grace 1 forgives one miss per week', () => {
    const completions = [
      at('2026-07-20'), at('2026-07-22'), // week -1: 1 miss
      at('2026-07-13'), at('2026-07-15'), // week -2: 1 miss
      at('2026-07-27'), at('2026-07-29'),
    ]
    expect(streak(completions, 1)).toBe(3)
  })

  it('grace 1 breaks on two misses; grace 2 forgives them', () => {
    const completions = [
      at('2026-07-20'), // week -1: 2 misses
      at('2026-07-27'), at('2026-07-29'),
    ]
    expect(streak(completions, 1)).toBe(1)
    expect(streak(completions, 2)).toBe(2)
  })

  it('a zero-training week never counts, even when grace would forgive it', () => {
    // Schedule of one day + grace 2: an empty week has misses 1 <= 2, but a
    // streak week must contain training — the walk stops.
    const completions = [
      at('2026-07-13'), // week -2 trained (Mon)
      at('2026-07-27'), // current Mon trained
    ]
    expect(streak(completions, 2, THU, [1])).toBe(1) // week -1 empty → stop
  })

  it('training on a non-scheduled day does not make a streak week', () => {
    const completions = [
      at('2026-07-19'), // week -1: Sunday only — not scheduled
      at('2026-07-27'), at('2026-07-29'),
    ]
    expect(streak(completions, 2)).toBe(1)
  })
})

describe('weeklyStreak — current-week satisfiability', () => {
  it('an untrained-but-satisfiable current week does not count yet and does not break', () => {
    // Monday morning: nothing elapsed, nothing trained — past streak holds.
    const MON = at('2026-07-27') // getDay() === 1; Mon itself is not yet a miss
    const completions = [
      at('2026-07-20'), at('2026-07-22'), at('2026-07-24'), // week -1 perfect
      at('2026-07-13'), at('2026-07-15'), at('2026-07-17'), // week -2 perfect
    ]
    expect(streak(completions, 0, MON)).toBe(2)
  })

  it("today's scheduled-but-untrained day is not yet a miss", () => {
    const WED = at('2026-07-29') // getDay() === 3, Wednesday itself pending
    const completions = [
      at('2026-07-20'), at('2026-07-22'), at('2026-07-24'),
      at('2026-07-27'), // current Mon trained; Wed is today
    ]
    expect(streak(completions, 0, WED)).toBe(2)
  })

  it('stops at the first failing past week', () => {
    const completions = [
      at('2026-07-20'), at('2026-07-22'), at('2026-07-24'), // week -1 perfect
      at('2026-07-13'), // week -2: 2 misses
      at('2026-07-06'), at('2026-07-08'), at('2026-07-10'), // week -3 perfect (unreachable)
      at('2026-07-27'), at('2026-07-29'),
    ]
    expect(streak(completions, 0)).toBe(2)
  })

  it('two completions on the same weekday count once', () => {
    const completions = [
      at('2026-07-27'), at('2026-07-27'), // Mon twice
      at('2026-07-29'),
    ]
    expect(streak(completions, 0)).toBe(1)
  })
})

describe('streakWeekTicks — same calendar as weeklyStreak', () => {
  function ticks(
    completions: Date[],
    allowedMissesPerWeek: number,
    targetWeeks: number,
    now: Date = THU,
    scheduledWeekdays: readonly number[] = MWF,
  ): WeekTickState[] {
    return streakWeekTicks(
      { scheduledWeekdays, completions, allowedMissesPerWeek, now },
      targetWeeks,
    )
  }

  it('lays out clean past weeks then the pulsing current week', () => {
    const completions = [
      at('2026-07-20'), at('2026-07-22'), at('2026-07-24'), // week -1 perfect
      at('2026-07-27'), at('2026-07-29'), // current trained
    ]
    expect(ticks(completions, 0, 4)).toEqual(['clean', 'current', 'future', 'future'])
  })

  it('marks a grace-surviving week as grace, not clean (grace matrix)', () => {
    const completions = [
      at('2026-07-20'), at('2026-07-22'), // week -1: 1 miss — needs grace 1
      at('2026-07-13'), at('2026-07-15'), at('2026-07-17'), // week -2 perfect
      at('2026-07-27'),
    ]
    expect(ticks(completions, 1, 4)).toEqual(['clean', 'grace', 'current', 'future'])
    // Grace 2 forgives a 2-miss week the 1-grace walk would break on.
    const sparse = [
      at('2026-07-20'), // week -1: 2 misses
      at('2026-07-27'),
    ]
    expect(ticks(sparse, 1, 4)).toEqual(['current', 'future', 'future', 'future'])
    expect(ticks(sparse, 2, 4)).toEqual(['grace', 'current', 'future', 'future'])
  })

  it('collapses a dead streak to the restart invitation (current at zero)', () => {
    const completions = [
      at('2026-07-20'), at('2026-07-22'), at('2026-07-24'), // week -1 perfect
      at('2026-07-27'), // current: Wed missed (elapsed by Thu), grace 0
    ]
    expect(ticks(completions, 0, 3)).toEqual(['current', 'future', 'future'])
  })

  it('drops the oldest weeks when the streak outgrows the row', () => {
    const completions = [
      at('2026-07-06'), at('2026-07-08'), at('2026-07-10'), // week -3 perfect
      at('2026-07-13'), at('2026-07-15'), at('2026-07-17'), // week -2 perfect
      at('2026-07-20'), at('2026-07-22'), at('2026-07-24'), // week -1 perfect
      at('2026-07-27'), at('2026-07-29'),
    ]
    expect(ticks(completions, 0, 2)).toEqual(['clean', 'current'])
  })

  it('shows only the current cell with no schedule (nothing to adhere to)', () => {
    expect(ticks([at('2026-07-27')], 1, 3, THU, [])).toEqual([
      'current',
      'future',
      'future',
    ])
  })

  it('returns [] for a junk target', () => {
    expect(ticks([], 1, 0)).toEqual([])
    expect(ticks([], 1, 2.5)).toEqual([])
  })

  it('never disagrees with weeklyStreak (counted cells = streak, capped)', () => {
    const completions = [
      at('2026-07-13'), at('2026-07-15'), // week -2: 1 miss
      at('2026-07-20'), at('2026-07-22'), at('2026-07-24'), // week -1 perfect
      at('2026-07-27'), at('2026-07-29'),
    ]
    const input = {
      scheduledWeekdays: MWF,
      completions,
      allowedMissesPerWeek: 1,
      now: THU,
    }
    const weeks = weeklyStreak(input) // 3: current + 2 past
    const row = streakWeekTicks(input, 8)
    const counted = row.filter((s) => s === 'clean' || s === 'grace').length
    // Current week trained → it counts in `weeks` but renders as 'current'.
    expect(counted + 1).toBe(weeks)
  })
})

describe('paceProjection', () => {
  const day = (n: number) => new Date(2026, 0, 1 + n, 12)

  it('is silent with fewer than 2 points', () => {
    expect(paceProjection([], 100, day(0))).toBe(null)
    expect(paceProjection([{ at: day(0), value: 90 }], 100, day(0))).toBe(null)
  })

  it('is silent for a flat or negative slope', () => {
    expect(
      paceProjection([{ at: day(0), value: 90 }, { at: day(10), value: 90 }], 100, day(10)),
    ).toBe(null)
    expect(
      paceProjection([{ at: day(0), value: 95 }, { at: day(10), value: 90 }], 100, day(10)),
    ).toBe(null)
  })

  it('projects a positive slope to the target date', () => {
    const projected = paceProjection(
      [{ at: day(0), value: 100 }, { at: day(10), value: 110 }],
      120,
      day(10),
    )
    // 1 unit/day from 110 → 120 lands 10 days after the last point.
    expect(projected).toEqual(day(20))
  })

  it('is silent when the latest value already meets the target', () => {
    expect(
      paceProjection([{ at: day(0), value: 100 }, { at: day(10), value: 120 }], 120, day(10)),
    ).toBe(null)
  })

  it('is silent beyond the sanity horizon', () => {
    const projected = paceProjection(
      [{ at: day(0), value: 100 }, { at: day(100), value: 100.1 }],
      200,
      day(100),
    )
    expect(projected).toBe(null) // ~0.001/day → a century out
  })

  it('clamps a stale-trend projection to now instead of the past', () => {
    const projected = paceProjection(
      [{ at: day(0), value: 100 }, { at: day(10), value: 119 }],
      120,
      day(40),
    )
    expect(projected).toEqual(day(40))
  })
})

describe('achievement predicates + percent', () => {
  it('strengthPercent clamps 0–100 and handles null', () => {
    expect(strengthPercent(null, 100)).toBe(0)
    expect(strengthPercent(50, 100)).toBe(50)
    expect(strengthPercent(150, 100)).toBe(100)
  })

  it('isStrengthAchieved needs a best at/over target', () => {
    expect(isStrengthAchieved(null, 100)).toBe(false)
    expect(isStrengthAchieved(99.9, 100)).toBe(false)
    expect(isStrengthAchieved(100, 100)).toBe(true)
  })

  it('bodyweight remaining respects direction; achieved at 0', () => {
    const down = { weightKg: 80, direction: 'down' as const }
    const up = { weightKg: 90, direction: 'up' as const }
    expect(bodyweightRemainingKg(null, down)).toBe(null)
    expect(bodyweightRemainingKg(85, down)).toBe(5)
    expect(bodyweightRemainingKg(79, down)).toBe(0) // overshoot = there
    expect(bodyweightRemainingKg(85, up)).toBe(5)
    expect(isBodyweightAchieved(80, down)).toBe(true)
    expect(isBodyweightAchieved(85, down)).toBe(false)
    expect(isBodyweightAchieved(null, down)).toBe(false)
  })

  it('isConsistencyAchieved compares streak to targetWeeks', () => {
    const target = { targetWeeks: 8, allowedMissesPerWeek: 1 as const }
    expect(isConsistencyAchieved(7, target)).toBe(false)
    expect(isConsistencyAchieved(8, target)).toBe(true)
  })
})

describe('goalTension + sortGoalsByTension', () => {
  const strength = (percent: number, achieved = false) => ({
    achieved,
    progress: { kind: 'strength' as const, percent },
  })
  const bodyweight = (remainingKg: number | null) => ({
    achieved: false,
    progress: { kind: 'bodyweight' as const, remainingKg },
  })
  const consistency = (streakWeeks: number, targetWeeks: number) => ({
    achieved: false,
    progress: { kind: 'consistency' as const, streakWeeks, targetWeeks },
  })

  it('achieved outranks everything; percents order actives', () => {
    expect(goalTension(strength(40, true))).toBe(101)
    expect(goalTension(strength(87))).toBe(87)
    expect(goalTension(consistency(6, 8))).toBe(75)
  })

  it('maps bodyweight closeness into (0, 100] and unknowns to the bottom', () => {
    expect(goalTension(bodyweight(0))).toBe(100)
    expect(goalTension(bodyweight(1))).toBe(50)
    expect(goalTension(bodyweight(4))).toBe(20)
    expect(goalTension(bodyweight(null))).toBe(-1)
  })

  it('sorts descending, stably, without mutating the input', () => {
    const entries = [
      bodyweight(null), // unknown → last
      strength(87),
      strength(40, true), // achieved → first
      consistency(6, 8), // 75
      bodyweight(1), // 50
    ]
    const frozen = [...entries]
    const sorted = sortGoalsByTension(entries)
    expect(sorted.map((e) => goalTension(e))).toEqual([101, 87, 75, 50, -1])
    expect(entries).toEqual(frozen) // untouched
  })
})

describe('paceVsDeadline', () => {
  const projected = new Date(2026, 9, 12) // Oct 12, local midnight

  it('is silent without a deadline', () => {
    expect(paceVsDeadline(projected, null)).toBe(null)
  })

  it('picks the ahead message, at one week and at several', () => {
    expect(paceVsDeadline(projected, '2026-11-02')).toEqual({
      key: 'paceAhead',
      values: { weeks: 3 },
    })
    expect(paceVsDeadline(projected, '2026-10-19')).toEqual({
      key: 'paceAhead',
      values: { weeks: 1 },
    })
  })

  it('picks the behind message, at one week and at several', () => {
    expect(paceVsDeadline(projected, '2026-10-05')).toEqual({
      key: 'paceBehind',
      values: { weeks: 1 },
    })
    expect(paceVsDeadline(projected, '2026-09-14')).toEqual({
      key: 'paceBehind',
      values: { weeks: 4 },
    })
  })

  it('is silent inside the same week — a verdict would be noise', () => {
    expect(paceVsDeadline(projected, '2026-10-15')).toBe(null)
    expect(paceVsDeadline(projected, '2026-10-09')).toBe(null)
  })

  it('is silent on a junk deadline', () => {
    expect(paceVsDeadline(projected, 'not-a-date')).toBe(null)
  })
})

describe('goalLabel', () => {
  it('names each kind in the display unit, exercise name as an argument', () => {
    expect(
      goalLabel({ kind: 'strength', target: { e1rmKg: 142.88 }, exerciseName: 'Squat' }, 'lb'),
    ).toEqual({ key: 'label.strength', values: { exercise: 'Squat', value: 315, unit: 'lb' } })
    expect(
      goalLabel(
        { kind: 'bodyweight', target: { weightKg: 80, direction: 'down' }, exerciseName: null },
        'kg',
      ),
    ).toEqual({ key: 'label.bodyweight', values: { value: 80, unit: 'kg' } })
    expect(
      goalLabel(
        {
          kind: 'consistency',
          target: { targetWeeks: 8, allowedMissesPerWeek: 1 },
          exerciseName: null,
        },
        'kg',
      ),
    ).toEqual({ key: 'label.consistency', values: { weeks: 8 } })
  })

  it('switches to the unnamed message rather than inventing an exercise name', () => {
    expect(
      goalLabel({ kind: 'strength', target: { e1rmKg: 100 }, exerciseName: null }, 'kg'),
    ).toEqual({ key: 'label.strengthUnnamed', values: { value: 100, unit: 'kg' } })
  })

  it('falls back quietly on a corrupt kind/target pairing', () => {
    expect(
      goalLabel(
        {
          kind: 'strength',
          target: { targetWeeks: 8, allowedMissesPerWeek: 1 },
          exerciseName: null,
        },
        'kg',
      ),
    ).toEqual({ key: 'label.unknown' })
  })
})
