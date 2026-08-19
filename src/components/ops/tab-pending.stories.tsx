import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { OpsTabPending } from "./tab-pending";

/**
 * Dims its children while a tab navigation is in flight (`animate-pending-dim`).
 *
 * It follows the same 150ms-delay rule as `Ghost`: a tab switch that resolves
 * faster than the delay never dims at all. The content stays readable
 * throughout — this is a "working on it" cue, not a blanking overlay, because
 * the previous tab's data is still the best thing to show.
 *
 * In Storybook there is no pending navigation, so the children render at full
 * opacity. That is the resolved state, and it is the correct one here.
 */
const meta = {
  title: "Ops/OpsTabPending",
  component: OpsTabPending,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OpsTabPending>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <ul className="divide-y divide-border/60 border-b border-b-border/60 text-sm">
        {[
          ["Errors", "0"],
          ["Deploys", "READY"],
          ["Checks", "4 up"],
        ].map(([label, value]) => (
          <li key={label} className="flex justify-between gap-4 py-3">
            <span>{label}</span>
            <span className="text-muted-foreground">{value}</span>
          </li>
        ))}
      </ul>
    ),
  },
}
