import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { MiniBarChart, type MiniBarPoint } from "./mini-bar-chart";
import { STORY_NOW } from "../story-time";

/**
 * The small daily-count bar chart used inside ops panels. One series, volt,
 * with the value in the tooltip — the same restraint as the product charts, at
 * panel scale.
 */
const meta = {
  title: "Ops/MiniBarChart",
  component: MiniBarChart,
  parameters: { layout: "padded" },
  args: { valueLabel: "Workouts", ariaLabel: "Workouts per day" },
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MiniBarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

const points = (values: number[]): MiniBarPoint[] =>
  values.map((value, i) => ({
    label: new Date(STORY_NOW - (values.length - 1 - i) * 86_400_000)
      .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    value,
  }));

export const Default: Story = {
  args: { points: points([4, 7, 2, 9, 5, 0, 6, 8, 3, 7, 5, 4, 9, 6]) },
}

/** Quiet fortnight. */
export const LowVolume: Story = {
  args: { points: points([0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0, 0, 1, 0]) },
}

/** All zeros must still draw an axis, not an empty box. */
export const AllZero: Story = {
  args: { points: points(new Array(14).fill(0)) },
}

/** A single day. */
export const SinglePoint: Story = { args: { points: points([5]) } }

/** One spike dominating the scale. */
export const WithOutlier: Story = {
  args: { points: points([2, 3, 1, 2, 48, 3, 2, 1, 3, 2, 4, 2, 1, 3]) },
}
