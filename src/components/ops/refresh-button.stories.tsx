import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { OpsRefreshButton } from "./refresh-button";

/**
 * Manual refresh for the ops dashboard: calls `router.refresh()` inside a
 * transition, so the server components re-run while the current data stays on
 * screen. Nothing blanks out mid-refresh — an ops dashboard that flashes empty
 * on every poll is worse than a stale one.
 */
const meta = {
  title: "Ops/OpsRefreshButton",
  component: OpsRefreshButton,
} satisfies Meta<typeof OpsRefreshButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {}

/** Beside the auto-refresh toggle, where it actually sits. */
export const InToolbar: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex w-[min(36rem,calc(100vw-2rem))] items-center justify-between gap-4">
      <h1 className="text-xl uppercase tracking-tight">Ops</h1>
      <OpsRefreshButton />
    </div>
  ),
}
