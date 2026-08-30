import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { HomeCellBoundary } from './home-cell-boundary'

/**
 * ONE home cell's error state. Home's widgets are independent async RSCs;
 * this boundary makes a failing read cost one tile instead of the whole
 * screen. The fallback wears the tile label voice — muted, never the accent —
 * because a missing tile is not an alarm.
 *
 * The failure state is deliberately not the EMPTY state: a widget with
 * nothing to say is never packed a cell at all (renderHomeSections).
 */
const meta = {
  title: 'Home/HomeCellBoundary',
  component: HomeCellBoundary,
  decorators: [
    // The bento cell's frame, so the fallback's mt-auto layout reads true.
    (Story) => (
      <div className="h-36 w-64 border border-border/60 p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HomeCellBoundary>

export default meta
type Story = StoryObj<typeof meta>

/** A cell whose render throws — the boundary's whole reason to exist.
 *  Retry re-renders the same thrower, so the fallback holds. */
function FailingCell(): never {
  throw new Error('Synthetic widget failure (story fixture)')
}

export const FailedCell: Story = {
  render: () => (
    <HomeCellBoundary>
      <FailingCell />
    </HomeCellBoundary>
  ),
}

/** A healthy child renders untouched — the boundary adds nothing. */
export const HealthyCell: Story = {
  render: () => (
    <HomeCellBoundary>
      <div className="flex h-full flex-col">
        <span className="font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
          Widget
        </span>
        <span className="mt-auto text-2xl font-semibold tnum">42</span>
      </div>
    </HomeCellBoundary>
  ),
}
