import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { OpsGhostPanel, OpsGhostStrip } from "./loading-ghosts";

/**
 * The ops dashboard's pending shapes.
 *
 * They follow the app-wide ghost contract (DESIGN.md § Pending states): a
 * ghost holds the geometry of the thing it stands in for, so arrival never
 * shifts layout — a panel ghost is panel-shaped, a strip ghost is strip-shaped.
 * Never a spinner, never a placeholder card of a different size.
 *
 * These start faded: the 150ms delay is real, and data that beats it means no
 * ghost is ever seen.
 */
const meta = {
  title: "Ops/LoadingGhosts",
  component: OpsGhostPanel,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OpsGhostPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Panel: Story = {}

/** Line count matches the panel it stands in for. */
export const ShortPanel: Story = { args: { lines: 2 } }

export const TallPanel: Story = { args: { lines: 8 } }

/** The status strip's pending shape. */
export const Strip: Story = { render: () => <OpsGhostStrip /> }

/** The dashboard mid-load — strip above, panels below. */
export const FullDashboard: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <OpsGhostStrip />
      <OpsGhostPanel lines={4} />
      <OpsGhostPanel lines={3} />
    </div>
  ),
}
