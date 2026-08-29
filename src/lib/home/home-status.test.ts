import { describe, it, expect } from 'vitest'
import { catalogTranslator } from '../../../vitest.intl'
import { renderLine } from '../message'
import {
  DRIFT_THRESHOLD_DAYS,
  dueHeadline,
  localDayDiff,
  momentumSessionsLine,
  statusForHome,
  type HomeStatusFacts,
} from './home-status'

/**
 * The status brain returns DESCRIPTORS, so these assert two separate things:
 * WHICH message each state picked (the decision — stable across any copy
 * edit), and, through the real catalog, what that message reads as. A test
 * that only asserted the English would block every future rewording.
 */
const hero = catalogTranslator('StatusHero')
const momentum = catalogTranslator('MomentumPanel')
const read = (line: Parameters<typeof renderLine>[1]) => renderLine(hero, line)

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
    expect(status.headline).toEqual({ key: 'headline.live' })
    expect(status.context).toEqual({
      key: 'context.live',
      values: { name: 'Push', sets: 5 },
    })
    expect(read(status.context)).toBe('Push · 5 sets logged')
  })

  it('session-live falls back to the unnamed label and singular set', () => {
    const status = statusForHome(
      facts({ session: { name: null, completedSetCount: 1 } }),
      'kg',
      now,
    )
    // The unnamed fallback is a nested descriptor, not a baked-in noun, so
    // one key covers both cases — and the plural is asserted at one AND many
    // (above), which is where a broken ICU branch actually shows up.
    expect(status.context).toEqual({
      key: 'context.live',
      values: { name: { key: 'unnamedSession' }, sets: 1 },
    })
    expect(read(status.context)).toBe('Unnamed session · 1 set logged')
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
    expect(today.headline).toEqual({ key: 'headline.done' })
    expect(read(today.context)).toMatch(/^Push · [\d,]+ lb$/)

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
    expect(status.context).toEqual({
      key: 'context.trained',
      values: { name: { key: 'untitledWorkout' } },
    })
    expect(read(status.context)).toBe('Workout · showed up — that counts')
  })

  it('block-complete crowns the program, after the trained-today check', () => {
    const status = statusForHome(
      facts({ nextDay: { ...legsDay, blockComplete: true } }),
      'kg',
      now,
    )
    expect(status.state).toBe('block-complete')
    // The program's name is the user's own word — a literal, never a key.
    expect(status.headline).toEqual({ literal: 'Upper/Lower' })
    expect(read(status.context)).toBe('7 weeks')
    expect(read(statusForHome(facts({ nextDay: { ...legsDay, blockComplete: true, mesocycleWeeks: 1 } }), 'kg', now).context)).toBe('1 week')
  })

  it('program-due: unscheduled day is always due, with the Up next eyebrow', () => {
    const status = statusForHome(facts({ nextDay: legsDay }), 'kg', now)
    expect(status.state).toBe('program-due')
    expect(status.eyebrow).toEqual({ key: 'eyebrow.upNext' })
    expect(read(status.headline)).toBe('Legs day.')
    expect(read(status.context)).toBe('Week 3 of 7')
  })

  it('program-due: a day scheduled today anchors the eyebrow to Today', () => {
    // now is a Monday (getDay 1)
    const status = statusForHome(
      facts({ nextDay: { ...legsDay, weekdays: [1, 5] } }),
      'kg',
      now,
    )
    expect(status.state).toBe('program-due')
    // The anchor arrives as a KIND and renders through the hero's own copy
    // of the day words — nothing here compares an English string.
    expect(status.eyebrow).toEqual({ key: 'anchor', values: { anchor: 'today' } })
    expect(read(status.eyebrow!)).toBe('Today')
  })

  it('program-due appends the last-time volume fact when derivable', () => {
    const status = statusForHome(
      facts({ nextDay: legsDay, lastTimeVolumeKg: 5200.4 }),
      'kg',
      now,
    )
    expect(status.context).toEqual({
      key: 'context.weekWithLastTime',
      values: { week: 3, total: 7, volume: '5,200 kg' },
    })
    expect(read(status.context)).toBe('Week 3 of 7 · last time: 5,200 kg')
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
    expect(status.headline).toEqual({ key: 'headline.rest' })
    expect(status.eyebrow).toEqual({ literal: 'Upper/Lower' })
    expect(read(status.context)).toBe('Next: Legs · Friday')
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
    expect(drifting.headline).toEqual({
      key: 'headline.drifting',
      values: { days: DRIFT_THRESHOLD_DAYS, session: 'Push' },
    })
    expect(read(drifting.headline)).toBe('4 days since Push.')
    expect(read(drifting.context)).toBe('Next up: Legs · Friday')
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
    expect(status.context).toEqual({ key: 'context.streak', values: { weeks: 6 } })
    expect(read(status.context)).toBe(
      'Your 6-week streak is on the line — one session keeps it.',
    )
  })

  it('drifting without program or streak stays warm and names the gap honestly', () => {
    const status = statusForHome(
      facts({
        lastCompleted: { name: null, completedAtMs: now.getTime() - 10 * dayMs, volumeKg: 1 },
      }),
      'kg',
      now,
    )
    expect(status.headline).toEqual({
      key: 'headline.drifting',
      values: { days: 10, session: { key: 'lastSession' } },
    })
    expect(read(status.headline)).toBe('10 days since your last session.')
    expect(read(status.context)).toBe('Pick up where you left off.')
  })

  it('fresh: true day one invites, a returning lifter gets the open door', () => {
    const dayOne = statusForHome(facts(), 'kg', now)
    expect(dayOne.state).toBe('fresh')
    expect(dayOne.headline).toEqual({ key: 'headline.dayOne' })
    expect(read(dayOne.headline)).toBe('Day one.')

    const returning = statusForHome(
      facts({
        lastCompleted: { name: 'Push', completedAtMs: now.getTime() - 1 * dayMs, volumeKg: 1 },
      }),
      'kg',
      now,
    )
    expect(returning.state).toBe('fresh')
    expect(returning.headline).toEqual({ key: 'headline.ready' })
    expect(read(returning.headline)).toBe('Ready when you are.')
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
    // The DECISION is which message the name earns; the suffix itself is
    // catalog copy, so both halves are asserted.
    expect(dueHeadline('Push')).toEqual({ key: 'headline.due', values: { day: 'Push' } })
    expect(dueHeadline('Leg Day')).toEqual({
      key: 'headline.dueSelfNamed',
      values: { day: 'Leg Day' },
    })
    expect(read(dueHeadline('Push'))).toBe('Push day.')
    expect(read(dueHeadline('Leg Day'))).toBe('Leg Day.')
    expect(read(dueHeadline('leg day'))).toBe('leg day.')
    // "day" as part of a word is not a suffix.
    expect(read(dueHeadline('Monday Squats'))).toBe('Monday Squats day.')
  })
})

describe('momentumSessionsLine', () => {
  it('pluralizes sessions', () => {
    expect(momentumSessionsLine(3)).toEqual({ key: 'sessionsLine', values: { count: 3 } })
    expect(renderLine(momentum, momentumSessionsLine(1))).toBe('1 session this week')
    expect(renderLine(momentum, momentumSessionsLine(3))).toBe('3 sessions this week')
  })
})
