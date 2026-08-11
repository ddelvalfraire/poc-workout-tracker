import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CoachChart, type CoachChartPoint } from "./coach-chart";

/**
 * Traces and cost per day for the coach panel — two series on different
 * scales, so cost gets its own axis.
 *
 * Traces are volt (the thing you are counting), cost is the muted ink. Two
 * series means the legend is mandatory: identity is never colour-alone.
 */
const meta = {
  title: "Ops/CoachChart",
  component: CoachChart,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CoachChart>;

export default meta;
type Story = StoryObj<typeof meta>;

const series = (traces: number[], perTrace = 0.0042): CoachChartPoint[] =>
  traces.map((t, i) => ({
    label: new Date(Date.now() - (traces.length - 1 - i) * 86_400_000)
      .toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    traces: t,
    cost: Number((t * perTrace).toFixed(4)),
  }));

export const Default: Story = {
  args: { points: series([18, 24, 31, 12, 27, 22, 9, 33, 28, 19, 25, 30, 14, 21]) },
}

/** Nothing logged — the chart still renders its axes. */
export const NoUsage: Story = { args: { points: series(new Array(14).fill(0)) } }

/**
 * Cost per trace jumped (a switch to a larger model) while trace count fell —
 * the case the dual axis exists for.
 */
export const CostSpikeWithoutTraceSpike: Story = {
  args: {
    points: series([18, 24, 31, 12, 27, 22, 9, 33, 28, 19, 25, 30, 14, 21]).map(
      (p, i) => (i > 9 ? { ...p, cost: Number((p.cost * 9).toFixed(4)) } : p),
    ),
  },
}

export const SingleDay: Story = { args: { points: series([24]) } }
