import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import type { ActivityItem } from "@/lib/ops/activity";

import { ActivityLog } from "./activity-log";
import { STORY_NOW } from "../story-time";

/**
 * The product-side activity feed: what actually happened in the app, filtered
 * by type chips.
 *
 * Lines arrive **pre-composed** from the server (`"[coach] Adjusted week 2
 * volume"`), so this component filters and lays out — it never formats domain
 * copy. The chips are controls, so they are chips; the lines are content, so
 * they are words.
 */
const meta = {
  title: "Ops/ActivityLog",
  component: ActivityLog,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ActivityLog>;

export default meta;
type Story = StoryObj<typeof meta>;

const ago = (minutes: number) => new Date(STORY_NOW - minutes * 60_000);

const ITEMS: ActivityItem[] = [
  { type: "workout", line: "Completed Push A — 18 sets, 9,820 kg", at: ago(35) },
  { type: "goal", line: "Bench 120 kg — 68% (was 64%)", at: ago(36) },
  { type: "bodyweight", line: "Logged 78.4 kg", at: ago(420) },
  { type: "program", line: "Advanced Push / Pull / Legs to week 3", at: ago(1500) },
  { type: "measurement", line: "Waist 81.5 cm", at: ago(2880) },
  { type: "photo", line: "Added a front progress photo", at: ago(2881) },
  { type: "workout", line: "Completed Pull B — 21 sets, 11,140 kg", at: ago(4320) },
  { type: "workout", line: "Completed Legs A — 16 sets, 12,480 kg", at: ago(7200) },
];

export const Default: Story = { args: { items: ITEMS } }

/** Nothing yet — a plain sentence, not a boxed apology. */
export const Empty: Story = { args: { items: [] } }

/** One type only: the chips must still make the filter state legible. */
export const SingleType: Story = {
  args: { items: ITEMS.filter((i) => i.type === "workout") },
}

/** A long feed — the scroll behaviour and chip stickiness. */
export const LongFeed: Story = {
  args: {
    items: Array.from({ length: 40 }, (_, i) => ITEMS[i % ITEMS.length]).map(
      (item, i) => ({ ...item, at: ago(30 + i * 90) }),
    ),
  },
}

/** All six types present, for the chip vocabulary. */
export const EveryType: Story = {
  args: {
    items: (
      ["workout", "program", "goal", "photo", "measurement", "bodyweight"] as const
    ).map((type, i) => ({
      type,
      line: `A ${type} event`,
      at: ago(30 + i * 120),
    })),
  },
}
