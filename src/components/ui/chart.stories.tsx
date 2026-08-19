import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "./chart";

/**
 * The Recharts wrapper: theme plumbing, tooltip and legend chrome.
 *
 * Series colour comes from the ink tokens — `var(--primary)` for the live
 * series, `var(--muted-foreground)` for comparison. The `--chart-1..5` tokens
 * are inherited shadcn scaffolding that this app never adopted (see
 * `src/design/tokens.ts`), which keeps the one-volt rule intact: the reading
 * you care about is volt, everything else is quiet.
 */
const meta = {
  title: "UI/Chart",
  component: ChartContainer,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChartContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

const WEEKLY = [
  { week: "W1", currentSets: 42, previousSets: 38 },
  { week: "W2", currentSets: 46, previousSets: 41 },
  { week: "W3", currentSets: 39, previousSets: 44 },
  { week: "W4", currentSets: 51, previousSets: 40 },
  { week: "W5", currentSets: 48, previousSets: 47 },
  { week: "W6", currentSets: 55, previousSets: 45 },
];

const CONFIG = {
  currentSets: { label: "This week", color: "var(--primary)" },
  previousSets: { label: "Last week", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

export const Bars: Story = {
  args: { config: CONFIG, children: <div /> },
  render: () => (
    <ChartContainer config={CONFIG}>
      <BarChart data={WEEKLY}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="currentSets" fill="var(--color-currentSets)" radius={4} />
      </BarChart>
    </ChartContainer>
  ),
}

/** Two series: the live one is volt, the comparison is quiet. */
export const Comparison: Story = {
  args: { config: CONFIG, children: <div /> },
  render: () => (
    <ChartContainer config={CONFIG}>
      <BarChart data={WEEKLY}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="previousSets" fill="var(--color-previousSets)" radius={4} />
        <Bar dataKey="currentSets" fill="var(--color-currentSets)" radius={4} />
      </BarChart>
    </ChartContainer>
  ),
}

export const Lines: Story = {
  args: { config: CONFIG, children: <div /> },
  render: () => (
    <ChartContainer config={CONFIG}>
      <LineChart data={WEEKLY}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis width={32} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          dataKey="currentSets"
          stroke="var(--color-currentSets)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  ),
}

/** A single point is still a valid chart — it must not collapse or crash. */
export const SinglePoint: Story = {
  args: { config: CONFIG, children: <div /> },
  render: () => (
    <ChartContainer config={CONFIG}>
      <BarChart data={[WEEKLY[0]]}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="currentSets" fill="var(--color-currentSets)" radius={4} />
      </BarChart>
    </ChartContainer>
  ),
}
