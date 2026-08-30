import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { TodayRecap, type RecapWorkout } from './today-recap'

/**
 * The TODAY recap — celebration, not a plain history row: each session
 * completed on the user's LOCAL today gets a divider row (name · duration ·
 * volume) linking to its summary; the volt lives on the Check icon and the
 * Today heading, never on the row surface.
 *
 * "Today" is the user's calendar day, filtered client-side after mount — so
 * the fixtures are relative to now; a workout stamped yesterday renders
 * nothing, and that silence is the contract.
 */
const meta = {
  title: 'Home/TodayRecap',
  component: TodayRecap,
} satisfies Meta<typeof TodayRecap>

export default meta
type Story = StoryObj<typeof meta>

const HOUR_MS = 3_600_000

function workout(overrides: Partial<RecapWorkout> & { id: string }): RecapWorkout {
  const completedAtMs = overrides.completedAtMs ?? Date.now() - HOUR_MS
  return {
    name: 'Push A',
    startedAtMs: completedAtMs - HOUR_MS,
    completedAtMs,
    volumeKg: 5200,
    ...overrides,
  }
}

export const OneSession: Story = {
  args: {
    workouts: [workout({ id: 'workout-1' })],
    unit: 'kg',
  },
}

export const TwoADay: Story = {
  args: {
    workouts: [
      workout({ id: 'workout-2', name: 'Conditioning', volumeKg: 0 }),
      workout({ id: 'workout-1', completedAtMs: Date.now() - 5 * HOUR_MS }),
    ],
    unit: 'kg',
  },
}

/** sm: one compact line for the whole day — the check, the count, the latest name. */
export const Small: Story = {
  args: {
    ...OneSession.args,
    size: 'sm',
  },
}

/**
 * Nothing completed on the LOCAL today renders NOTHING — the empty canvas is
 * the contract, not a broken story (yesterday's work is history's, not today's).
 */
export const NothingTodayRendersNothing: Story = {
  args: {
    workouts: [workout({ id: 'workout-3', completedAtMs: Date.now() - 30 * HOUR_MS })],
    unit: 'kg',
  },
}
