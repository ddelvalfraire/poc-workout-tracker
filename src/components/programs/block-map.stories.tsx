import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { BlockMap, BlockSegment } from "./block-map";
import type { BlockWeek } from "./block-weeks";

/**
 * The block map — the ONE shared mesocycle visualisation (the TrainerRoad /
 * Juggernaut pattern). A row of week segments, each filling by its
 * days-completed fraction. Learn it once on the programs list, read it
 * identically on the program detail strip and the stats week rows.
 *
 * The grammar matters more than the geometry:
 * - **fill** — volt. Completed weeks read solid; achievement earns the accent.
 * - **deload** — hollow and bordered, with a volt *outline* fill and a `DL`
 *   label. A planned easy week must never read as slacking.
 * - **current** — ringed. "You are here", anchored to where training actually
 *   is, which is distinct from whichever week the surface is browsing.
 *
 * Pure presentation and server-renderable; all derivation lives in
 * `./block-weeks`.
 */
const meta = {
  title: "Components/BlockMap",
  component: BlockMap,
  parameters: { layout: "padded" },
  argTypes: { size: { control: "inline-radio", options: ["compact", "default"] } },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BlockMap>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A 4-week block, three done, week 4 the deload, currently mid-week 3. */
const BLOCK: BlockWeek[] = [
  { week: 1, dayCountDone: 4, dayCountTotal: 4, isDeload: false, isCurrent: false },
  { week: 2, dayCountDone: 4, dayCountTotal: 4, isDeload: false, isCurrent: false },
  { week: 3, dayCountDone: 2, dayCountTotal: 4, isDeload: false, isCurrent: true },
  { week: 4, dayCountDone: 0, dayCountTotal: 3, isDeload: true, isCurrent: false },
];

export const Compact: Story = { args: { weeks: BLOCK, size: "compact" } }

/** `default` adds the week numbers and the `DL` deload marker. */
export const Default: Story = { args: { weeks: BLOCK, size: "default" } }

/** Linked segments — the program detail page's week switcher. */
export const AsWeekSwitcher: Story = {
  args: {
    weeks: BLOCK,
    size: "default",
    selectedWeek: 2,
    hrefForWeek: (week) => `?week=${week}`,
  },
}

/** A fresh block: nothing done yet, week 1 live. */
export const BlockStart: Story = {
  args: {
    size: "default",
    weeks: [
      { week: 1, dayCountDone: 0, dayCountTotal: 4, isDeload: false, isCurrent: true },
      { week: 2, dayCountDone: 0, dayCountTotal: 4, isDeload: false, isCurrent: false },
      { week: 3, dayCountDone: 0, dayCountTotal: 4, isDeload: false, isCurrent: false },
      { week: 4, dayCountDone: 0, dayCountTotal: 3, isDeload: true, isCurrent: false },
    ],
  },
}

/** A finished block — every segment solid. */
export const BlockComplete: Story = {
  args: {
    size: "default",
    weeks: BLOCK.map((w) => ({
      ...w,
      dayCountDone: w.dayCountTotal,
      isCurrent: false,
    })),
  },
}

/** A longer mesocycle still fits the phone column — segments flex down. */
export const TwelveWeeks: Story = {
  args: {
    size: "default",
    weeks: Array.from({ length: 12 }, (_, i): BlockWeek => {
      const week = i + 1;
      const isDeload = week % 4 === 0;
      return {
        week,
        dayCountDone: week < 7 ? (isDeload ? 3 : 4) : week === 7 ? 2 : 0,
        dayCountTotal: isDeload ? 3 : 4,
        isDeload,
        isCurrent: week === 7,
      };
    }),
  },
}

/** The segment on its own — the shared geometry the stats week rows reuse. */
export const Segments: Story = {
  args: { weeks: BLOCK },
  render: () => (
    <div className="flex flex-col gap-4">
      {[
        { label: "Empty", props: { dayCountDone: 0, dayCountTotal: 4, isDeload: false } },
        { label: "Half", props: { dayCountDone: 2, dayCountTotal: 4, isDeload: false } },
        { label: "Full", props: { dayCountDone: 4, dayCountTotal: 4, isDeload: false } },
        { label: "Deload, empty", props: { dayCountDone: 0, dayCountTotal: 3, isDeload: true } },
        { label: "Deload, full", props: { dayCountDone: 3, dayCountTotal: 3, isDeload: true } },
      ].map(({ label, props }) => (
        <div key={label} className="flex items-center gap-4">
          <span className="w-28 shrink-0 text-xs uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
          <BlockSegment {...props} size="default" className="flex-1" />
        </div>
      ))}
    </div>
  ),
}
