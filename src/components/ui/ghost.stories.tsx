import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { STAT_TILE_SHELL } from "../charts/stat-tile";

import { Ghost } from "./ghost";

/**
 * The pending-state placeholder (DESIGN.md § Pending states).
 *
 * A ghost holds the EXACT box its content will occupy — same wrappers, same
 * margins, bar boxed to the text's line height — so arrival never shifts
 * layout. Three rules the component itself enforces:
 *
 * - **150ms delay.** Base opacity is 0 with a 150ms `animation-delay`, so data
 *   that beats the delay means no ghost is ever seen. Never a flash.
 * - **Pulse, not shimmer.** A 1.8s opacity pulse under `motion-safe:` only;
 *   a static bar under reduced motion. No sweep, no new colour.
 * - **Decorative by contract** (`aria-hidden`). A ghost never carries copy or
 *   state — the surrounding surface stays the accessible truth.
 *
 * Note the stories below start faded: that 150ms delay is real, and you are
 * seeing exactly what a user with a fast connection would not.
 */
const meta = {
  title: "Components/Ghost",
  component: Ghost,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Ghost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { className: "h-4 w-40" } }

/** Boxed to a line of text — the bar matches the line height it replaces. */
export const TextLine: Story = { args: { className: "h-5 w-56" } }

/**
 * A ghost of a real surface: the same hairline geometry as the loaded
 * DividerList, never placeholder cards.
 */
export const GhostedList: Story = {
  args: { className: "h-5 w-32" },
  render: () => (
    <ul className="w-[min(28rem,calc(100vw-2rem))] divide-y divide-border/60 border-b border-b-border/60">
      {[
        ["w-40", "w-10"],
        ["w-32", "w-12"],
        ["w-44", "w-8"],
      ].map(([label, value], i) => (
        <li key={i} className="flex items-center justify-between gap-4 py-4">
          <Ghost className={`h-5 ${label}`} />
          <Ghost className={`h-4 ${value}`} />
        </li>
      ))}
    </ul>
  ),
}

/**
 * A ghosted stat tile keeps the tile's exact box — and reads that box from
 * StatTile rather than restating it, so the two cannot drift apart.
 */
export const GhostedStatTile: Story = {
  args: { className: "h-4 w-20" },
  render: () => (
    <div className={`w-[min(20rem,calc(100vw-2rem))] ${STAT_TILE_SHELL}`}>
      <Ghost className="h-3 w-20" />
      <Ghost className="mt-2 h-7 w-24" />
      <Ghost className="mt-2 h-4 w-32" />
    </div>
  ),
}

/** Side by side with the resolved content it stands in for — same box. */
export const GhostVsResolved: Story = {
  args: { className: "h-5 w-40" },
  render: () => (
    <div className="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-6">
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          Pending
        </p>
        <div className="flex items-center justify-between gap-4 border-b border-b-border/60 py-4">
          <Ghost className="h-5 w-40" />
          <Ghost className="h-4 w-12" />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          Resolved
        </p>
        <div className="flex items-center justify-between gap-4 border-b border-b-border/60 py-4">
          <span>Bench press</span>
          <span className="text-muted-foreground">12 sets</span>
        </div>
      </div>
    </div>
  ),
}
