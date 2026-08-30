import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PrBadge } from "./pr-badge";

/**
 * The ONE personal-record marker: a solid volt pill with the trophy glyph.
 *
 * Logger captions, collapsed cards and the workout summary all render this
 * exact chip, so the record moment never drifts into competing per-surface
 * treatments. It is a genuine volt moment — which means at most one PR badge
 * should be visible at a time on a revisit surface (DESIGN.md § One volt).
 */
const meta = {
  title: "Components/PrBadge",
  component: PrBadge,
} satisfies Meta<typeof PrBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {}

/** The label is overridable for a more specific record. */
export const CustomLabel: Story = { args: { label: "5RM PR" } }

export const VolumePr: Story = { args: { label: "Volume PR" } }

/** In its natural habitat — a logger caption line. */
export const InContext: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="w-[min(28rem,calc(100vw-2rem))]">
      <div className="flex items-baseline justify-between gap-3 border-b border-b-border/60 py-4">
        <span className="truncate">Bench press</span>
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
          102.5 kg × 5
          <PrBadge {...args} />
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 border-b border-b-border/60 py-4">
        <span className="truncate">Incline press</span>
        <span className="shrink-0 text-muted-foreground">70 kg × 8</span>
      </div>
    </div>
  ),
}
