import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { OpsPanel } from "./panel";
import { STORY_NOW } from "../story-time";

/**
 * The shell every ops panel wears: title, status dot, optional vendor deep
 * link, and the two degraded voices.
 *
 * The three statuses are distinct facts and must not be blurred:
 * - `ok` — the vendor answered.
 * - `degraded` — the vendor is down; the panel shows the cache's stale copy
 *   with a quiet "as of" note rather than an empty box.
 * - `unconfigured` — the integration was never set up. It names the env var
 *   to set, because "no data" and "no credentials" are different problems and
 *   a dashboard that conflates them wastes an on-call engineer's time.
 */
const meta = {
  title: "Ops/OpsPanel",
  component: OpsPanel,
  parameters: { layout: "padded" },
  args: { id: "errors", title: "Errors", status: "ok" },
  argTypes: {
    status: { control: "inline-radio", options: ["ok", "degraded", "unconfigured"] },
  },
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OpsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = (
  <ul className="divide-y divide-border/60 border-b border-b-border/60 text-sm">
    {[
      ["TypeError: undefined is not a function", "app/api/chat/route", "42"],
      ["Failed to fetch", "components/nav/nav-drawer", "17"],
      ["AbortError", "lib/ops/sentry", "3"],
    ].map(([title, culprit, count]) => (
      <li key={title} className="flex items-center justify-between gap-4 py-3">
        <span className="min-w-0">
          <span className="block truncate">{title}</span>
          <span className="block truncate text-muted-foreground">{culprit}</span>
        </span>
        <span className="shrink-0 text-muted-foreground tnum">{count}</span>
      </li>
    ))}
  </ul>
);

export const Ok: Story = { args: { children: body } }

export const WithVendorLink: Story = {
  args: {
    children: body,
    link: { href: "https://sentry.io", label: "Sentry ↗" },
  },
}

/** Vendor down: cached data plus a quiet "as of" note. Never an empty box. */
export const Degraded: Story = {
  args: {
    status: "degraded",
    staleAt: new Date(STORY_NOW - 4 * 3600_000).toISOString(),
    children: body,
  },
}

/** Never set up — it names the env var rather than implying "no errors". */
export const Unconfigured: Story = {
  args: {
    status: "unconfigured",
    envVar: "SENTRY_AUTH_TOKEN",
    title: "Errors",
  },
}

/** Empty but healthy — the vendor answered and there is genuinely nothing. */
export const OkButEmpty: Story = {
  args: {
    children: (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">
        No unresolved issues in the last 24h.
      </p>
    ),
  },
}

/** All three voices side by side — the distinction is the whole point. */
export const StatusComparison: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <OpsPanel id="a" title="Healthy" status="ok">
        <p className="py-4 text-sm text-muted-foreground">The vendor answered.</p>
      </OpsPanel>
      <OpsPanel
        id="b"
        title="Vendor down"
        status="degraded"
        staleAt={new Date(STORY_NOW - 2 * 3600_000).toISOString()}
      >
        <p className="py-4 text-sm text-muted-foreground">Showing the cached copy.</p>
      </OpsPanel>
      <OpsPanel id="c" title="Not set up" status="unconfigured" envVar="SENTRY_AUTH_TOKEN" />
    </div>
  ),
}
