import { describe, it, expect } from 'vitest'
import {
  DRIFT_THRESHOLD_DAYS,
  dueHeadline,
  localDayDiff,
  momentumSessionsLine,
  momentumWeekDeltaLine,
  statusForHome,
  type HomeStatusFacts,
} from './home-status'

// Local-calendar fixture: a fixed midday LOCAL "now" keeps day math
// unambiguous (same convention as drawer-status.test.ts).
const now = new Date(2026, 7, 3, 12, 0, 0) // Mon Aug 3 2026, local

const dayMs = 24 * 60 * 60 * 1000

function facts(overrides: Partial<HomeStatusFacts> = {}): HomeStatusFacts {
  return {
    session: null,
    nextDay: null,
    recentCompletedAtTimes: [],
    lastCompleted: null,
    lastTimeVolumeKg: null,
    streakWeeks: null,
    ...overrides,
  }
}

const legsDay = {
  dayName: 'Legs',
  programName: 'Upper/Lower',
  week: 3,
  mesocycleWeeks: 7,
  weekdays: [] as number[],
  blockComplete: false,
}

describe('statusForHome', () => {
  it('session-live wins over every other state', () => {
    const status = statusForHome(
      facts({
        session: { name: 'Push', completedSetCount: 5 },
        nextDay: legsDay,
        recentCompletedAtTimes: [now.getTime() - 60_000],
        lastCompleted: { name: 'Push', completedAtMs: now.getTime() - 60_000, volumeKg: 1000 },
      }),
      'kg',
      now,
    )
    expect(status.state).toBe('session-live')
    expect(status.headline).toBe('In the middle of it.')
    expect(status.context).toBe('Push · 5 sets logged')
  })

  it('session-live falls back to the unnamed label and singular set', () => {
    const status = statusForHome(
      facts({ session: { name: null, completedSetCount: 1 } }),
      'kg',
      now,
    )
    expect(status.context).toBe('Unnamed session · 1 set logged')
  })

  it('trained-today fires only for completions on the LOCAL calendar day', () => {
    const thisMorning = new Date(2026, 7, 3, 7, 30).getTime()
    const lastNight = new Date(2026, 7, 2, 23, 59).getTime()

    const today = statusForHome(
      facts({
        nextDay: legsDay,
        recentCompletedAtTimes: [thisMorning],
        lastCompleted: { name: 'Push', completedAtMs: thisMorning, volumeKg: 3663.6 },
      }),
      'lb',
      now,
    )
    expect(today.state).toBe('trained-today')
    expect(today.headline).toBe('Done for today.')
    expect(today.context).toMatch(/^Push · [\d,]+ lb$/)

    // 12.5h ago but YESTERDAY locally — the old rolling-window bug this fork
    // exists to prevent: the program day must come back due.
    const yesterday = statusForHome(
      facts({
        nextDay: legsDay,
        recentCompletedAtTimes: [lastNight],
        lastCompleted: { name: 'Push', completedAtMs: lastNight, volumeKg: 3663.6 },
      }),
      'lb',
      now,
    )
    expect(yesterday.state).toBe('program-due')
  })

  it('trained-today falls back to the showed-up phrase when volume is zero', () => {
    const at = new Date(2026, 7, 3, 8, 0).getTime()
    const status = statusForHome(
      facts({
        recentCompletedAtTimes: [at],
        lastCompleted: { name: null, completedAtMs: at, volumeKg: 0 },
      }),
      'kg',
      now,
    )
    expect(status.context).toBe('Workout · showed up — that counts')
  })

  it('block-complete crowns the program, after the trained-today check', () => {
    const status = statusForHome(
      facts({ nextDay: { ...legsDay, blockComplete: true } }),
      'kg',
      now,
    )
    expect(status.state).toBe('block-complete')
    expect(status.headline).toBe('Upper/Lower')
    expect(status.context).toBe('7 weeks')
  })

  it('program-due: unscheduled day is always due, with the Up next eyebrow', () => {
    const status = statusForHome(facts({ nextDay: legsDay }), 'kg', now)
    expect(status.state).toBe('program-due')
    expect(status.eyebrow).toBe('Up next')
    expect(status.headline).toBe('Legs day.')
    expect(status.context).toBe('Week 3 of 7')
  })

  it('program-due: a day scheduled today anchors the eyebrow to Today', () => {
    // now is a Monday (getDay 1)
    const status = statusForHome(
      facts({ nextDay: { ...legsDay, weekdays: [1, 5] } }),
      'kg',
      now,
    )
    expect(status.state).toBe('program-due')
    expect(status.eyebrow).toBe('Today')
  })

  it('program-due appends the last-time volume fact when derivable', () => {
    const status = statusForHome(
      facts({ nextDay: legsDay, lastTimeVolumeKg: 5200.4 }),
      'kg',
      now,
    )
    expect(status.context).toBe('Week 3 of 7 · last time: 5,200 kg')
  })

  it('rest-day: scheduled later this week, recently trained', () => {
    const status = statusForHome(
      facts({
        nextDay: { ...legsDay, weekdays: [5] }, // Friday
        lastCompleted: { name: 'Push', completedAtMs: now.getTime() - 2 * dayMs, volumeKg: 900 },
      }),
      'kg',
      now,
    )
    expect(status.state).toBe('rest-day')
    expect(status.headline).toBe('Rest day.')
    expect(status.eyebrow).toBe('Upper/Lower')
    expect(status.context).toBe('Next: Legs · Friday')
  })

  it('drifting threshold: 3 whole local days off is still rest, 4 is drifting', () => {
    const scheduled = { ...legsDay, weekdays: [5] }
    const daysAgo = (days: number) => new Date(2026, 7, 3 - days, 18, 0).getTime()

    const resting = statusForHome(
      facts({
        nextDay: scheduled,
        lastCompleted: {
          name: 'Push',
          completedAtMs: daysAgo(DRIFT_THRESHOLD_DAYS - 1),
          volumeKg: 1,
        },
      }),
      'kg',
      now,
    )
    expect(resting.state).toBe('rest-day')

    const drifting = statusForHome(
      facts({
        nextDay: scheduled,
        lastCompleted: {
          name: 'Push',
          completedAtMs: daysAgo(DRIFT_THRESHOLD_DAYS),
          volumeKg: 1,
        },
      }),
      'kg',
      now,
    )
    expect(drifting.state).toBe('drifting')
    expect(drifting.headline).toBe('4 days since Push.')
    expect(drifting.context).toBe('Next up: Legs · Friday')
  })

  it('drifting prefers the streak-at-risk fact when a streak exists', () => {
    const status = statusForHome(
      facts({
        lastCompleted: { name: 'Push', completedAtMs: now.getTime() - 5 * dayMs, volumeKg: 1 },
        streakWeeks: 6,
      }),
      'kg',
      now,
    )
    expect(status.state).toBe('drifting')
    expect(status.context).toBe('Your 6-week streak is on the line — one session keeps it.')
  })

  it('drifting without program or streak stays warm and names the gap honestly', () => {
    const status = statusForHome(
      facts({
        lastCompleted: { name: null, completedAtMs: now.getTime() - 10 * dayMs, volumeKg: 1 },
      }),
      'kg',
      now,
    )
    expect(status.headline).toBe('10 days since your last session.')
    expect(status.context).toBe('Pick up where you left off.')
  })

  it('fresh: true day one invites, a returning lifter gets the open door', () => {
    const dayOne = statusForHome(facts(), 'kg', now)
    expect(dayOne.state).toBe('fresh')
    expect(dayOne.headline).toBe('Day one.')

    const returning = statusForHome(
      facts({
        lastCompleted: { name: 'Push', completedAtMs: now.getTime() - 1 * dayMs, volumeKg: 1 },
      }),
      'kg',
      now,
    )
    expect(returning.state).toBe('fresh')
    expect(returning.headline).toBe('Ready when you are.')
  })
})

describe('localDayDiff', () => {
  it('counts LOCAL midnight crossings, not 24h spans', () => {
    // 23:59 → next-day noon is 1 day despite only ~12h elapsing.
    expect(localDayDiff(new Date(2026, 7, 2, 23, 59).getTime(), now)).toBe(1)
    // 00:01 same day → noon is 0 days despite ~12h elapsing.
    expect(localDayDiff(new Date(2026, 7, 3, 0, 1).getTime(), now)).toBe(0)
    expect(localDayDiff(new Date(2026, 6, 30, 12, 0).getTime(), now)).toBe(4)
  })
})

describe('dueHeadline', () => {
  it('appends the day suffix without stuttering', () => {
    expect(dueHeadline('Push')).toBe('Push day.')
    expect(dueHeadline('Leg Day')).toBe('Leg Day.')
    expect(dueHeadline('leg day')).toBe('leg day.')
    // "day" as part of a word is not a suffix.
    expect(dueHeadline('Monday Squats')).toBe('Monday Squats day.')
  })
})

describe('momentumSessionsLine', () => {
  it('pluralizes sessions', () => {
    expect(momentumSessionsLine(1)).toBe('1 session this week')
    expect(momentumSessionsLine(3)).toBe('3 sessions this week')
  })
})

describe('momentumWeekDeltaLine', () => {
  it('states the direction and magnitude against last week', () => {
    expect(momentumWeekDeltaLine(20, 12)).toBe('Up 8 on last week')
    expect(momentumWeekDeltaLine(9, 12)).toBe('Down 3 on last week')
    expect(momentumWeekDeltaLine(12, 12)).toBe('Level with last week')
  })

  it('stays silent when last week has no sets (nothing honest to compare)', () => {
    expect(momentumWeekDeltaLine(15, 0)).toBeNull()
    expect(momentumWeekDeltaLine(0, 0)).toBeNull()
  })
})
