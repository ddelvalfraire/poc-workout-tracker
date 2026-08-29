import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Sparkbar } from "./sparkbar";

/**
 * The seven-block volume sparkbar — rolling 24h buckets, oldest first.
 *
 * Extracted from the nav drawer so the home momentum panel renders the SAME
 * week shape instead of forking it. Zero-set days keep a 2px baseline so the
 * week always reads as seven days rather than collapsing to the days trained.
 *
 * `aria-hidden` by contract: the caller's status line carries the accessible
 * fact. No hooks, so it renders in both server and client trees.
 */
const meta = {
  title: "Components/Sparkbar",
  component: Sparkbar,
  args: { daySets: [4, 0, 6, 3, 0, 8, 5] },
} satisfies Meta<typeof Sparkbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {}

/** A full week trained. */
export const EveryDay: Story = { args: { daySets: [5, 6, 4, 7, 5, 6, 8] } }

/** Nothing logged — seven baseline blocks, not an empty box. */
export const RestWeek: Story = { args: { daySets: [0, 0, 0, 0, 0, 0, 0] } }

/** A single session still scales to full height (max is its own value). */
export const SingleSession: Story = {
  args: { daySets: [0, 0, 0, 9, 0, 0, 0] },
}

/** The home momentum panel renders it taller and wider. */
export const HomePanelSize: Story = {
  args: { daySets: [4, 0, 6, 3, 0, 8, 5], className: "h-10 gap-1.5", barClassName: "w-3" },
}

/** Drawer default beside the home size, for the shared-shape check. */
export const SizeComparison: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          Drawer (default)
        </p>
        <Sparkbar {...args} />
      </div>
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          Home momentum panel
        </p>
        <Sparkbar {...args} className="h-10 gap-1.5" barClassName="w-3" />
      </div>
    </div>
  ),
}

/** With the status line that carries the accessible fact. */
export const WithStatusLine: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="flex w-[min(28rem,calc(100vw-2rem))] items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">26 sets this week</span>
      <Sparkbar {...args} />
    </div>
  ),
}
