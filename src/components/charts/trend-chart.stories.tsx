import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { TrendChart, type TrendPoint } from "./trend-chart";

/**
 * The app's ONE time-series chart: a single-series area trend with a
 * crosshair tooltip. It replaces the raw sparkline anywhere a trend is the
 * point of the page (exercise est-1RM, bodyweight) — a sparkline shows shape
 * but cannot answer "when was that?" or "what was the value?".
 *
 * Single series means **no legend** — the section heading names it. Values
 * live in the tooltip, never painted on every point, which is what keeps the
 * chart readable at phone width.
 *
 * A client island by necessity (Recharts renders client-side). Pages stay
 * server components and pass pre-formatted points, so Recharts only loads on
 * routes that actually chart.
 */
const meta = {
  title: "Charts/TrendChart",
  component: TrendChart,
  parameters: { layout: "padded" },
  args: { unit: "kg", valueLabel: "Est. 1RM", ariaLabel: "Estimated 1RM over time" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TrendChart>;

export default meta;
type Story = StoryObj<typeof meta>;

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 2, 2);

const fmt = (t: number) =>
  new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** A rising e1RM with two records along the way. */
const CLIMB: TrendPoint[] = [
  108, 109.5, 109, 111, 112.5, 112, 114, 115.5, 115, 117, 118.5, 120,
].map((value, i) => ({
  label: fmt(START + i * 7 * DAY_MS),
  value,
  t: START + i * 7 * DAY_MS,
  pr: i === 5 || i === 11,
}));

export const Default: Story = { args: { points: CLIMB } }

/** With a goal target — the reference line extends the y-domain if it's above. */
export const WithTarget: Story = {
  args: { points: CLIMB, targetValue: 130, targetLabel: "Target" },
}

/**
 * Trend-over-noise: the smoothed line with the honest raw weigh-ins as faint
 * dots underneath. They stay visible without shouting.
 */
export const WithRawSeries: Story = {
  args: {
    valueLabel: "Bodyweight (EMA)",
    ariaLabel: "Bodyweight over time",
    rawLabel: "Weigh-in",
    points: [
      78.9, 78.6, 78.8, 78.4, 78.5, 78.1, 78.2, 77.9, 78.0, 77.7, 77.8, 77.5,
    ].map((value, i) => ({
      label: fmt(START + i * 7 * DAY_MS),
      value,
      raw: value + (i % 3 === 0 ? 0.6 : i % 3 === 1 ? -0.5 : 0.2),
      t: START + i * 7 * DAY_MS,
    })),
  },
}

/**
 * Every point carries `t`, so the axis goes numeric/time and a layoff reads as
 * a real gap instead of two adjacent ticks. Compare with `CategoricalAxis`.
 */
export const TimeAxisWithLayoff: Story = {
  args: {
    points: [0, 1, 2, 3, 12, 13, 14].map((weekOffset) => {
      const t = START + weekOffset * 7 * DAY_MS;
      return {
        label: fmt(t),
        value: 108 + weekOffset * 0.6,
        t,
      };
    }),
  },
}

/** Omitting `t` on the points gives the evenly-spaced categorical axis. */
export const CategoricalAxis: Story = {
  args: {
    points: CLIMB.map((point) => ({
      label: point.label,
      value: point.value,
      pr: point.pr,
    })),
  },
}

/** Flat data must not collapse the y-domain to a zero-height band. */
export const FlatLine: Story = {
  args: {
    points: Array.from({ length: 8 }, (_, i) => ({
      label: fmt(START + i * 7 * DAY_MS),
      value: 100,
      t: START + i * 7 * DAY_MS,
    })),
  },
}

/** Two points is the minimum that draws a line. */
export const TwoPoints: Story = { args: { points: CLIMB.slice(0, 2) } }

/** A single reading — the chart must render, not crash. */
export const SinglePoint: Story = { args: { points: CLIMB.slice(0, 1) } }

/** Compact placement override. */
export const Compact: Story = { args: { points: CLIMB, className: "h-24" } }
