import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { StatTile } from "./stat-tile";

/**
 * The record/metric tile — one shape for every stat in the app, and a
 * **keep-list** shell (a tile grid is the scannable record wall).
 *
 * Two rules worth repeating, both encoded in the component:
 * - The value uses proportional figures. Tabular (`tnum`) is for COLUMNS of
 *   numbers — set tables, axis ticks — and reads loose at display sizes.
 * - The delta's colour carries meaning: volt = progress, muted = neutral
 *   context. It is never decoration, which is what keeps the one-volt rule
 *   intact on a grid of tiles.
 *
 * Purely presentational: every field arrives pre-formatted. The tile lays out,
 * it never computes or converts units.
 */
const meta = {
  title: "Components/StatTile",
  component: StatTile,
  parameters: { layout: "padded" },
  args: { label: "Best set", value: "102.5", unit: "kg" },
  decorators: [
    (Story) => (
      <dl className="w-[min(20rem,calc(100vw-2rem))]">
        <Story />
      </dl>
    ),
  ],
} satisfies Meta<typeof StatTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {}

export const WithPositiveDelta: Story = {
  args: {
    delta: { text: "+2.5 kg vs first session", tone: "positive" },
    caption: "12 Mar 2026",
  },
}

/** Neutral tone for context that is not progress — bodyweight drift, volume. */
export const WithNeutralDelta: Story = {
  args: {
    label: "Bodyweight",
    value: "78.4",
    unit: "kg",
    delta: { text: "−0.3 kg vs last week", tone: "neutral" },
    caption: "This morning",
  },
}

/** A decline renders quiet, never in the destructive colour. */
export const Decline: Story = {
  args: {
    label: "Weekly volume",
    value: "12,480",
    unit: "kg",
    delta: { text: "−8% vs last week", tone: "neutral" },
  },
}

export const NoUnit: Story = {
  args: { label: "Sessions", value: "148", unit: undefined },
}

export const LabelAndValueOnly: Story = {
  args: { label: "Streak", value: "6", unit: "wk" },
}

export const LongValue: Story = {
  args: { label: "Lifetime volume", value: "1,284,930", unit: "kg" },
}

/**
 * The record wall. Note only ONE tile carries a volt delta — on a revisit
 * surface, per-item volt stacks and is banned (DESIGN.md § One volt).
 */
export const Grid: Story = {
  parameters: { layout: "padded" },
  decorators: [],
  render: () => (
    <dl className="grid w-[min(28rem,calc(100vw-2rem))] grid-cols-2 gap-3">
      <StatTile
        label="Best set"
        value="102.5"
        unit="kg"
        delta={{ text: "+2.5 kg", tone: "positive" }}
        caption="12 Mar 2026"
      />
      <StatTile label="Est. 1RM" value="118" unit="kg" caption="Epley" />
      <StatTile label="Sessions" value="148" />
      <StatTile
        label="Bodyweight"
        value="78.4"
        unit="kg"
        delta={{ text: "−0.3 kg", tone: "neutral" }}
      />
    </dl>
  ),
}
