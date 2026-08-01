import { describe, it, expect } from 'vitest'
import {
  bodyweightRemainingKg,
  goalLabel,
  isBodyweightAchieved,
  isConsistencyAchieved,
  isStrengthAchieved,
  paceProjection,
  strengthPercent,
  weeklyStreak,
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

describe('goalLabel', () => {
  it('names each kind in the display unit', () => {
    expect(
      goalLabel(
        { kind: 'strength', target: { e1rmKg: 142.88 }, exerciseName: 'Squat' },
        'lb',
      ),
    ).toBe('Squat 315 lb')
    expect(
      goalLabel(
        { kind: 'bodyweight', target: { weightKg: 80, direction: 'down' }, exerciseName: null },
        'kg',
      ),
    ).toBe('Bodyweight 80 kg')
    expect(
      goalLabel(
        {
          kind: 'consistency',
          target: { targetWeeks: 8, allowedMissesPerWeek: 1 },
          exerciseName: null,
        },
        'kg',
      ),
    ).toBe('8-week streak')
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
    ).toBe('Goal')
  })
})
