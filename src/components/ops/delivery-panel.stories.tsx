import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import type { HealthchecksSnapshot } from "@/lib/ops/healthchecks";
import type { OpsResult } from "@/lib/ops/types";
import type { VercelSnapshot } from "@/lib/ops/vercel";

import { DeliveryPanel } from "./delivery-panel";

/**
 * Deploys and cron health in one panel: Vercel deployments plus Healthchecks
 * pings.
 *
 * Its two sources fail independently, which is the case worth designing for —
 * "deploys are fine but cron has not pinged in a day" is a real and common
 * state, and the panel must show both truths at once rather than collapsing to
 * a single status.
 */
const meta = {
  title: "Ops/DeliveryPanel",
  component: DeliveryPanel,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DeliveryPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const deploy = (
  state: string,
  sha7: string,
  commitMessage: string,
  hoursAgo: number,
  durationMs: number | null,
) => ({
  state,
  isFailed: state === "ERROR" || state === "CANCELED",
  sha7,
  commitMessage,
  createdAt: Date.now() - hoursAgo * 3600_000,
  durationMs,
  url: `poc-workout-tracker-${sha7}.vercel.app`,
});

const VERCEL_OK: OpsResult<VercelSnapshot> = {
  ok: true,
  data: {
    deployments: [
      deploy("READY", "a1b2c3d", "Add Storybook for all UI components", 1, 84_000),
      deploy("READY", "9f8e7d6", "Fix rest timer drift on resume", 6, 79_000),
      deploy("READY", "1122334", "Tighten volume chart legend", 26, 91_000),
    ],
  },
};

const check = (
  name: string,
  status: string,
  lastPingHoursAgo: number | null,
) => ({
  name,
  status,
  lastPing:
    lastPingHoursAgo === null
      ? null
      : new Date(Date.now() - lastPingHoursAgo * 3600_000).toISOString(),
  nextPing: new Date(Date.now() + 3600_000).toISOString(),
  flips: [],
});

const HC_OK: OpsResult<HealthchecksSnapshot> = {
  ok: true,
  data: {
    checks: [
      check("reminders-cron", "up", 0.4),
      check("nightly-backup", "up", 5),
      check("weekly-digest", "up", 30),
    ],
    downCount: 0,
  },
};

export const AllHealthy: Story = {
  args: { vercel: VERCEL_OK, healthchecks: HC_OK },
}

/** A failed deploy is the row the table has to make loud. */
export const FailedDeploy: Story = {
  args: {
    vercel: {
      ok: true,
      data: {
        deployments: [
          deploy("ERROR", "deadbee", "Broken migration", 0.5, null),
          ...VERCEL_OK.ok ? VERCEL_OK.data.deployments : [],
        ],
      },
    },
    healthchecks: HC_OK,
  },
}

/** Mid-build: no duration yet. */
export const Building: Story = {
  args: {
    vercel: {
      ok: true,
      data: {
        deployments: [
          deploy("BUILDING", "feed1ee", "Token pipeline for iOS/Android", 0.05, null),
          ...VERCEL_OK.ok ? VERCEL_OK.data.deployments : [],
        ],
      },
    },
    healthchecks: HC_OK,
  },
}

/** The case worth designing for: deploys fine, a cron has gone quiet. */
export const CronDown: Story = {
  args: {
    vercel: VERCEL_OK,
    healthchecks: {
      ok: true,
      data: {
        checks: [
          check("reminders-cron", "down", 27),
          check("nightly-backup", "up", 5),
          check("weekly-digest", "grace", 26),
        ],
        downCount: 1,
      },
    },
  },
}

/** Neither integration configured. */
export const BothUnconfigured: Story = {
  args: {
    vercel: { ok: false, reason: "unconfigured" },
    healthchecks: { ok: false, reason: "unconfigured" },
  },
}

/** One source down, the other healthy — both truths shown at once. */
export const MixedAvailability: Story = {
  args: {
    vercel: VERCEL_OK,
    healthchecks: { ok: false, reason: "unavailable" },
  },
}

/** Cached deploys after a Vercel outage. */
export const StaleCache: Story = {
  args: {
    vercel: {
      ok: true,
      data: VERCEL_OK.ok ? VERCEL_OK.data : { deployments: [] },
      staleAt: new Date(Date.now() - 9 * 3600_000).toISOString(),
    },
    healthchecks: HC_OK,
  },
}
