import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { VolumeBarChart } from "./volume-bar-chart";

/**
 * Weekly sets per muscle group: horizontal paired bars — this week in volt,
 * last week in the muted ink — one row per group, so ten groups fit a phone
 * without rotating a single label.
 *
 * Multiple series means the legend is **mandatory**: identity is never
 * colour-alone. Exact values live in the tooltip rather than being painted on
 * the bars. When rows carry `plannedSets` (an active program), a third thin
 * bar marks the weekly target; without it the render is unchanged.
 */
const meta = {
  title: "Charts/VolumeBarChart",
  component: VolumeBarChart,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VolumeBarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

type Group = Parameters<typeof VolumeBarChart>[0]["groups"][number];

const GROUPS = [
  ["Chest", 14, 12],
  ["Back", 18, 16],
  ["Quads", 12, 14],
  ["Hamstrings", 9, 8],
  ["Shoulders", 11, 10],
  ["Biceps", 8, 9],
  ["Triceps", 10, 7],
  ["Glutes", 7, 6],
  ["Calves", 4, 6],
  ["Core", 6, 5],
] as const;

const base: Group[] = GROUPS.map(([group, currentSets, previousSets]) => ({
  group,
  currentSets,
  previousSets,
}) as Group);

export const Default: Story = { args: { groups: base } }

/** With an active program: the thin third bar is the weekly target. */
export const WithPlannedTarget: Story = {
  args: {
    groups: base.map((g, i) => ({ ...g, plannedSets: [12, 16, 14, 10, 10, 8, 8, 8, 6, 6][i] })),
  },
}

/** A first week — nothing to compare against yet. */
export const FirstWeek: Story = {
  args: { groups: base.map((g) => ({ ...g, previousSets: 0 })) },
}

/** A deload: every group down against last week. */
export const DeloadWeek: Story = {
  args: {
    groups: base.map((g) => ({
      ...g,
      currentSets: Math.round(g.currentSets * 0.5),
    })),
  },
}

/** Half-sets are real values — secondary muscles are credited at 0.5. */
export const HalfSets: Story = {
  args: {
    groups: base.slice(0, 4).map((g) => ({
      ...g,
      currentSets: g.currentSets + 0.5,
    })),
  },
}

/** A short list still lays out correctly. */
export const FewGroups: Story = { args: { groups: base.slice(0, 3) } }
