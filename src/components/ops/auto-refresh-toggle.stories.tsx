import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AutoRefreshToggle } from "./auto-refresh-toggle";

/**
 * Polls the ops dashboard on an interval while enabled.
 *
 * A **control cluster** — the on state is the volt. It owns its own state and
 * persistence, so there are no props to vary: press it to see both states.
 */
const meta = {
  title: "Ops/AutoRefreshToggle",
  component: AutoRefreshToggle,
} satisfies Meta<typeof AutoRefreshToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {}

/** In the dashboard toolbar. */
export const InToolbar: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex w-[min(36rem,calc(100vw-2rem))] items-center justify-between gap-4">
      <h1 className="text-xl uppercase tracking-tight">Ops</h1>
      <AutoRefreshToggle />
    </div>
  ),
}
