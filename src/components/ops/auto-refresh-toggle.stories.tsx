import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

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

/**
 * Keyboard focus must be visible (WCAG 2.4.7). This switch paired
 * `outline-none` with `focus-visible:border-primary` — a 1px border swap, and
 * the last ops control still doing that after the chips moved to the ring. It
 * now takes the same volt ring, so focus looks identical everywhere.
 */
export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    const toggle = within(canvasElement).getByRole("switch");
    // Unfocused, the switch paints no ring…
    await expect(getComputedStyle(toggle).boxShadow).toBe("none");
    await userEvent.tab();
    await expect(toggle).toHaveFocus();
    // …and keyboard focus paints the 3px volt ring (ring-3 ring-ring/50).
    await expect(getComputedStyle(toggle).boxShadow).toContain("3px");
  },
}
