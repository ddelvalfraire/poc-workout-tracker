import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import type {
  LangfuseSnapshot,
  LangfuseTracesSnapshot,
} from "@/lib/ops/langfuse";
import type { OpsResult } from "@/lib/ops/types";

import { CoachPanel } from "./coach-panel";

/**
 * LLM spend and latency for the coach, from Langfuse: 14-day totals, a daily
 * traces/cost chart, and the most recent calls.
 *
 * The daily rollup and the recent-traces list are separate fetches and so
 * separate `OpsResult`s — the panel must degrade one without losing the other.
 * Cost is the number an owner actually watches here, which is why it leads.
 */
const meta = {
  title: "Ops/CoachPanel",
  component: CoachPanel,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CoachPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const days: LangfuseSnapshot["days"] = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.now() - i * 86_400_000);
  const traces = [18, 24, 31, 12, 27, 22, 9, 33, 28, 19, 25, 30, 14, 21][i];
  return {
    date: d.toISOString().slice(0, 10),
    traces,
    totalCost: Number((traces * 0.0042).toFixed(4)),
    tokens: traces * 1850,
  };
});

const DAILY: OpsResult<LangfuseSnapshot> = {
  ok: true,
  data: {
    days,
    totalTraces: days.reduce((s, d) => s + d.traces, 0),
    totalCost: Number(days.reduce((s, d) => s + d.totalCost, 0).toFixed(4)),
    totalCost7d: Number(
      days.slice(0, 7).reduce((s, d) => s + d.totalCost, 0).toFixed(4),
    ),
  },
};

const TRACES: OpsResult<LangfuseTracesSnapshot> = {
  ok: true,
  data: {
    traces: [
      { time: new Date(Date.now() - 12 * 60_000).toISOString(), name: "coach-chat", latencyMs: 3120, totalCost: 0.0061, tokens: 2140, model: "claude-opus-5" },
      { time: new Date(Date.now() - 48 * 60_000).toISOString(), name: "program-patch", latencyMs: 8430, totalCost: 0.0184, tokens: 6120, model: "claude-opus-5" },
      { time: new Date(Date.now() - 95 * 60_000).toISOString(), name: "coach-chat", latencyMs: 1890, totalCost: 0.0037, tokens: 1310, model: "claude-sonnet-5" },
      { time: new Date(Date.now() - 180 * 60_000).toISOString(), name: "weekly-summary", latencyMs: null, totalCost: 0.0092, tokens: 3400, model: "claude-sonnet-5" },
    ],
  },
};

export const Default: Story = { args: { daily: DAILY, traces: TRACES } }

/** No coach usage yet — zeros, not an error. */
export const NoUsage: Story = {
  args: {
    daily: { ok: true, data: { days: [], totalTraces: 0, totalCost: 0, totalCost7d: 0 } },
    traces: { ok: true, data: { traces: [] } },
  },
}

/** An expensive week — the number an owner is actually watching. */
export const HighSpend: Story = {
  args: {
    daily: {
      ok: true,
      data: {
        days: days.map((d) => ({ ...d, totalCost: d.totalCost * 22 })),
        totalTraces: 3120,
        totalCost: 41.87,
        totalCost7d: 24.9,
      },
    },
    traces: TRACES,
  },
}

export const Unconfigured: Story = {
  args: {
    daily: { ok: false, reason: "unconfigured" },
    traces: { ok: false, reason: "unconfigured" },
  },
}

/** Rollup survived, recent traces did not — one degrades without the other. */
export const TracesUnavailable: Story = {
  args: { daily: DAILY, traces: { ok: false, reason: "unavailable" } },
}

export const StaleCache: Story = {
  args: {
    daily: {
      ok: true,
      data: DAILY.ok ? DAILY.data : { days: [], totalTraces: 0, totalCost: 0, totalCost7d: 0 },
      staleAt: new Date(Date.now() - 7 * 3600_000).toISOString(),
    },
    traces: TRACES,
  },
}
