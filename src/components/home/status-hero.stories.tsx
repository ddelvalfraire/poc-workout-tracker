import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { StatusHero, type StatusHeroProps } from './status-hero'

/**
 * The STATUS zone — home's always-rendered hero. Seven states, and the
 * priority order IS the product: live > done-today > block payoff > the
 * program's answer > drift > fresh (lib/home-status.ts). The status never
 * vanishes; it changes.
 *
 * The state is derived from the facts against the REAL clock (trained today?
 * drifting how long? scheduled today?), so every fixture below is relative to
 * "now" — a frozen epoch would collapse every story into "drifting".
 */
const meta = {
  title: 'Home/StatusHero',
  component: StatusHero,
} satisfies Meta<typeof StatusHero>

export default meta
type Story = StoryObj<typeof meta>

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** Facts baseline: a lifter with no live session, no program, no history. */
const baseline: StatusHeroProps = {
  session: null,
  nextDay: null,
  recentCompletedAtTimes: [],
  lastCompleted: null,
  lastTimeVolumeKg: null,
  streak: null,
  guardSession: null,
  unit: 'kg',
}

const nextDay = {
  dayId: 'day-1',
  programId: 'program-1',
  programName: 'Volume Cut',
  dayName: 'Push A',
  week: 2,
  mesocycleWeeks: 6,
  weekdays: [] as number[],
  blockComplete: false,
}

/** A weekday that is guaranteed not to be today (for rest-day fixtures). */
const notToday = (new Date().getDay() + 3) % 7

/** Live session: pulsing dot, sets progressbar, full-width Resume CTA. */
export const SessionLive: Story = {
  args: {
    ...baseline,
    session: { key: 'a1b2c3', name: 'Push A', setCount: 18, completedSetCount: 7 },
  },
}

/** Trained today: done is a STATE, not an absence — receipt link + quiet log-more. */
export const TrainedToday: Story = {
  args: {
    ...baseline,
    recentCompletedAtTimes: [Date.now() - 2 * HOUR_MS],
    lastCompleted: {
      id: 'workout-1',
      name: 'Push A',
      completedAtMs: Date.now() - 2 * HOUR_MS,
      volumeKg: 5200,
    },
  },
}

/** Program day due (unscheduled program → always "Up next"): Start CTA. */
export const ProgramDue: Story = {
  args: {
    ...baseline,
    nextDay,
    lastTimeVolumeKg: 5100,
  },
}

/** Scheduled program, not due today: quiet rest day. */
export const RestDay: Story = {
  args: {
    ...baseline,
    nextDay: { ...nextDay, weekdays: [notToday] },
  },
}

/** No session in 4+ days: the drift nudge, with the program's next anchor. */
export const Drifting: Story = {
  args: {
    ...baseline,
    nextDay: { ...nextDay, weekdays: [notToday] },
    lastCompleted: {
      id: 'workout-2',
      name: 'Pull B',
      completedAtMs: Date.now() - 6 * DAY_MS,
      volumeKg: 4800,
    },
  },
}

/** Block finished: the payoff state — program name as headline, results door. */
export const BlockComplete: Story = {
  args: {
    ...baseline,
    nextDay: { ...nextDay, blockComplete: true },
  },
}

/** True day one: the invitation. */
export const FreshDayOne: Story = {
  args: baseline,
}

/** Returning lifter, no program: the open door. */
export const FreshReturning: Story = {
  args: {
    ...baseline,
    lastCompleted: {
      id: 'workout-3',
      name: 'Legs',
      completedAtMs: Date.now() - 1 * DAY_MS,
      volumeKg: 6100,
    },
  },
}
