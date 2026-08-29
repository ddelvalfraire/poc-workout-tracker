import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { CheckInCard } from './check-in-card'

/**
 * The quiet "body check-in due" nudge. The server renders it only when the
 * active program's cadence says a check-in is due, so the stories show the
 * due state; dismissal is dismiss-for-today via sessionStorage — tap "Not
 * today" and the card stays gone until the storage key rolls over at local
 * midnight (clear sessionStorage to bring it back in the canvas).
 */
const meta = {
  title: 'Home/CheckInCard',
  component: CheckInCard,
} satisfies Meta<typeof CheckInCard>

export default meta
type Story = StoryObj<typeof meta>

export const Due: Story = {
  args: { daysSinceLast: 14 },
}

/** Never checked in: the lede's detail switches to the first-time phrasing. */
export const NeverCheckedIn: Story = {
  args: { daysSinceLast: null },
}
