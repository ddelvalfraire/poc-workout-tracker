import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { EditorScopeLine } from "./editor-scope-line";

/**
 * The persistent scope line — where editing begins, said before the edit.
 *
 * The week is always a COUNT, never a tri-state control: "mixed" is a state a
 * user can leave but never enter, and its only semantic is "toggle my
 * children", which is exactly what must be forbidden here. The block sentence
 * above it is the shipped one from `programStatusLine`, so this surface and the
 * detail page can never disagree about where the block stands.
 */
const meta = {
  title: "Editor/EditorScopeLine",
  component: EditorScopeLine,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EditorScopeLine>;

export default meta;
type Story = StoryObj<typeof meta>;

const base = {
  statusLine: "Week 3 of 7 · 2 days to go.",
  week: 3,
  report: { trained: 2, total: 4, allTrained: false },
  hasHistory: true,
};

/** A part-done week reports the count that a week-level badge could not. */
export const MixedWeek: Story = { args: base };

/** Every session settled — the shipped phrase, not a new one. */
export const WeekTrained: Story = {
  args: {
    ...base,
    statusLine: "Week 3 of 7 · week trained · deload next week.",
    report: { trained: 4, total: 4, allTrained: true },
  },
};

/** A week the user has not started; the count still says something true. */
export const NothingTrainedYet: Story = {
  args: { ...base, week: 5, report: { trained: 0, total: 4, allTrained: false } },
};

/**
 * A draft that was never started. There is no trained state to report, so the
 * count is omitted entirely rather than computed from nothing — "0 of 4
 * trained" would dress an absence up as a measurement.
 */
export const DraftNeverStarted: Story = {
  args: {
    ...base,
    week: 1,
    statusLine: "Week 1 of 7 · 4 days to go.",
    report: { trained: 0, total: 4, allTrained: false },
    hasHistory: false,
  },
};

/**
 * A finished block. "Block complete." is the shipped sentence — and complete
 * does NOT mean read-only: the final week is re-runnable, and a re-run is a
 * fresh instantiation that will pick up edits made here.
 */
export const BlockComplete: Story = {
  args: {
    ...base,
    week: 7,
    statusLine: "Block complete.",
    report: { trained: 4, total: 4, allTrained: true },
  },
};
