import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { UpNextAnchor } from './up-next-anchor'

/**
 * The hero eyebrow's text for a SCHEDULED next day: "Today · Week N",
 * "Tomorrow · Week N", or "Friday · Week N". The anchor is computed against
 * the browser's calendar after mount (only the client knows the user's day),
 * so the weekday fixtures are relative to now. A bare text fragment — the
 * stories dress it in the eyebrow's own uppercase voice to show it in place.
 */
const meta = {
  title: 'Home/UpNextAnchor',
  component: UpNextAnchor,
  decorators: [
    (Story) => (
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
        <Story />
      </p>
    ),
  ],
} satisfies Meta<typeof UpNextAnchor>

export default meta
type Story = StoryObj<typeof meta>

const today = new Date().getDay()

export const Today: Story = {
  args: { weekdays: [today], week: 2 },
}

export const Tomorrow: Story = {
  args: { weekdays: [(today + 1) % 7], week: 2 },
}

/** A named weekday: the next scheduled day is 3 days out. */
export const LaterThisWeek: Story = {
  args: { weekdays: [(today + 3) % 7], week: 5 },
}
