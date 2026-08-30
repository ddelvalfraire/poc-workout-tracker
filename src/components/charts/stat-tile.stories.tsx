import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";

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
} satisfies Meta<typeof StatTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * StatTile renders dt/dd, which are only valid inside a <dl>. Single-tile
 * stories opt into this wrapper; `Grid` supplies its own <dl> and must not get
 * a second — HTML permits at most ONE <div> between <dl> and its dt/dd, and
 * the tile's shell already spends it.
 *
 * A decorator reference rather than a story parameter: Storybook's `Parameters`
 * type carries an index signature, so a misspelled flag would type-check and
 * silently do nothing. A misspelled import will not compile.
 */
const inDefinitionList: Decorator = (Story) => (
  <dl className="w-[min(20rem,calc(100vw-2rem))]">
    <Story />
  </dl>
);

export const Default: Story = { decorators: [inDefinitionList] }

export const WithPositiveDelta: Story = {
  decorators: [inDefinitionList],
  args: {
    delta: { text: "+2.5 kg vs first session", tone: "positive" },
    caption: "12 Mar 2026",
  },
}

/** Neutral tone for context that is not progress — bodyweight drift, volume. */
export const WithNeutralDelta: Story = {
  decorators: [inDefinitionList],
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
  decorators: [inDefinitionList],
  args: {
    label: "Weekly volume",
    value: "12,480",
    unit: "kg",
    delta: { text: "−8% vs last week", tone: "neutral" },
  },
}

export const NoUnit: Story = {
  decorators: [inDefinitionList],
  args: { label: "Sessions", value: "148", unit: undefined },
}

export const LabelAndValueOnly: Story = {
  decorators: [inDefinitionList],
  args: { label: "Streak", value: "6", unit: "wk" },
}

export const LongValue: Story = {
  decorators: [inDefinitionList],
  args: { label: "Lifetime volume", value: "1,284,930", unit: "kg" },
}

/**
 * The record wall. Note only ONE tile carries a volt delta — on a revisit
 * surface, per-item volt stacks and is banned (DESIGN.md § One volt).
 */
export const Grid: Story = {
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
