import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { StatusStrip, type StatusPill } from "./status-strip";

/**
 * The at-a-glance row at the top of the ops dashboard: one pill per panel,
 * each an in-page anchor down to the panel it summarises.
 *
 * Four tones, and the ordering they imply: `bad` (something is broken) >
 * `warn` (something needs attention) > `ok` > `muted` (not configured — an
 * absence of data, not a healthy zero).
 */
const meta = {
  title: "Ops/StatusStrip",
  component: StatusStrip,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StatusStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

const pill = (
  label: string,
  value: string,
  tone: StatusPill["tone"],
): StatusPill => ({ href: `#${label.toLowerCase()}`, label, value, tone });

export const AllHealthy: Story = {
  args: {
    pills: [
      pill("Errors", "0", "ok"),
      pill("Deploys", "READY", "ok"),
      pill("Checks", "4 up", "ok"),
      pill("Coach", "$1.24", "ok"),
    ],
  },
}

export const SomethingBroken: Story = {
  args: {
    pills: [
      pill("Errors", "37", "bad"),
      pill("Deploys", "ERROR", "bad"),
      pill("Checks", "1 down", "warn"),
      pill("Coach", "$1.24", "ok"),
    ],
  },
}

/** Muted is "not configured" — distinct from a healthy zero. */
export const PartlyUnconfigured: Story = {
  args: {
    pills: [
      pill("Errors", "0", "ok"),
      pill("Deploys", "READY", "ok"),
      pill("Checks", "—", "muted"),
      pill("Coach", "—", "muted"),
    ],
  },
}

/** Every tone, for the vocabulary check. */
export const AllTones: Story = {
  args: {
    pills: [
      pill("Ok", "healthy", "ok"),
      pill("Warn", "needs a look", "warn"),
      pill("Bad", "broken", "bad"),
      pill("Muted", "—", "muted"),
    ],
  },
}

/**
 * Keyboard focus must be visible (WCAG 2.4.7). These pills paired
 * `outline-none` with `focus-visible:border-primary` — a 1px border swap, and
 * the last ops control still doing that after the chips moved to the ring.
 * They now take the same volt ring, so focus looks identical everywhere.
 */
export const KeyboardFocus: Story = {
  args: { pills: [pill("Errors", "0", "ok"), pill("Deploys", "READY", "ok")] },
  play: async ({ canvasElement }) => {
    const [first] = within(canvasElement).getAllByRole("link");
    // Unfocused, the pill paints no ring…
    await expect(getComputedStyle(first).boxShadow).toBe("none");
    await userEvent.tab();
    await expect(first).toHaveFocus();
    // …and keyboard focus paints the 3px volt ring (ring-3 ring-ring/50).
    await expect(getComputedStyle(first).boxShadow).toContain("3px");
  },
}
