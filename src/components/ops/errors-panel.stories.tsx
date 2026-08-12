import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import type { SentryPeriod, SentrySnapshot } from "@/lib/ops/sentry";
import type { OpsResult } from "@/lib/ops/types";

import { ErrorsPanel } from "./errors-panel";

/**
 * The Sentry panel. Both windows (24h and 14d) are fetched in the page's
 * parallel batch and handed in together, so switching period is instant and
 * never re-fetches.
 *
 * Each window is an `OpsResult`, which means either window can independently
 * be unavailable — the panel has to stay readable when one is and the other
 * is not.
 */
const meta = {
  title: "Ops/ErrorsPanel",
  component: ErrorsPanel,
  parameters: { layout: "padded" },
  args: { sentryUrl: "https://sentry.io/organizations/acme/issues/" },
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ErrorsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

let issueId = 0;

const issue = (
  title: string,
  culprit: string,
  count: string,
  level = "error",
) => ({
  title,
  level,
  culprit,
  count,
  userCount: Number(count) > 20 ? 8 : 2,
  // The panel keys rows by permalink; real Sentry permalinks are unique.
  permalink: `https://sentry.io/issues/${++issueId}`,
  firstSeen: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  lastSeen: new Date(Date.now() - 3600_000).toISOString(),
});

const snapshot = (
  period: SentryPeriod,
  unresolvedCount: number,
  topIssues: SentrySnapshot["topIssues"],
): OpsResult<SentrySnapshot> => ({
  ok: true,
  data: { period, unresolvedCount, topIssues },
});

const BUSY = [
  issue("TypeError: undefined is not a function", "app/api/chat/route", "142"),
  issue("Failed to fetch", "components/nav/nav-drawer", "38", "warning"),
  issue("AbortError: signal is aborted", "lib/ops/sentry", "12", "warning"),
  issue("Invariant: headers() called outside request", "app/layout", "4", "fatal"),
];

export const Default: Story = {
  args: {
    results: {
      "24h": snapshot("24h", 37, BUSY),
      "14d": snapshot("14d", 214, BUSY),
    },
  },
}

/** The good day: the vendor answered and there is genuinely nothing. */
export const NoErrors: Story = {
  args: {
    results: {
      "24h": snapshot("24h", 0, []),
      "14d": snapshot("14d", 0, []),
    },
  },
}

/** Never set up — this must not read as "zero errors". */
export const Unconfigured: Story = {
  args: {
    results: {
      "24h": { ok: false, reason: "unconfigured" },
      "14d": { ok: false, reason: "unconfigured" },
    },
  },
}

/** Sentry is down. */
export const Unavailable: Story = {
  args: {
    results: {
      "24h": { ok: false, reason: "unavailable" },
      "14d": { ok: false, reason: "unavailable" },
    },
  },
}

/** Cached copy after a vendor outage — note the "as of" time. */
export const StaleCache: Story = {
  args: {
    results: {
      "24h": {
        ok: true,
        data: { period: "24h", unresolvedCount: 37, topIssues: BUSY },
        staleAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
      },
      "14d": {
        ok: true,
        data: { period: "14d", unresolvedCount: 214, topIssues: BUSY },
        staleAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
      },
    },
  },
}

/** One window resolved, the other did not — the panel stays readable. */
export const MixedAvailability: Story = {
  args: {
    results: {
      "24h": snapshot("24h", 37, BUSY),
      "14d": { ok: false, reason: "unavailable" },
    },
  },
}
