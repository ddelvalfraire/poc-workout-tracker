import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { EditorStructurePane } from "./editor-structure-pane";
import type { EditorDay, EditorWeek } from "./editor-model";

/**
 * Pane 1 — the editor's table of contents.
 *
 * The rows are the same links in both projections: on phone they navigate, at
 * width they select. The selected DAY is the surface's one volt moment; the
 * selected week is marked with weight and `aria-current` instead, so the accent
 * never stacks.
 */
const meta = {
  title: "Editor/EditorStructurePane",
  component: EditorStructurePane,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      // The token width (`editor-structure-pane-width`, 244) so the column is
      // judged at the size it actually gets.
      <div className="w-[min(244px,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EditorStructurePane>;

export default meta;
type Story = StoryObj<typeof meta>;

const weeks: EditorWeek[] = [
  { week: 1, isDeload: false, isBeyondBlock: false },
  { week: 2, isDeload: false, isBeyondBlock: false },
  { week: 3, isDeload: false, isBeyondBlock: false },
  { week: 4, isDeload: true, isBeyondBlock: false },
];

const days: EditorDay[] = [
  { position: 0, name: "Push", exerciseCount: 5, trained: null },
  { position: 1, name: "Pull", exerciseCount: 5, trained: null },
  { position: 2, name: "Legs", exerciseCount: 4, trained: null },
];

const base = {
  weeks,
  selectedWeek: 3,
  hrefForWeek: (week: number) => `?week=${week}`,
  days,
  selectedDay: null,
  hrefForDay: (day: number) => `./${day}`,
};

/** The phone's landing state: a week is always selected, no day is yet. */
export const NoDaySelected: Story = { args: base };

/** A day selected — the one volt moment on the surface. */
export const DaySelected: Story = { args: { ...base, selectedDay: 1 } };

/**
 * After a mesocycle shrink. Weeks 5 and 6 were really trained and now sit ABOVE
 * `mesocycleWeeks`; a list that looped `1..mesocycleWeeks` would hide them, so
 * they are listed and labelled instead.
 */
export const TrainedWeeksPastTheBlock: Story = {
  args: {
    ...base,
    selectedWeek: 5,
    weeks: [
      ...weeks.slice(0, 3),
      { week: 5, isDeload: false, isBeyondBlock: true },
      { week: 6, isDeload: false, isBeyondBlock: true },
    ],
  },
};

/** A program with no days yet — plain words, not a boxed apology. */
export const NoDays: Story = { args: { ...base, days: [] } };

/** A one-week block: the week list still exists and still says which week. */
export const SingleWeek: Story = {
  args: { ...base, weeks: [weeks[0]], selectedWeek: 1, selectedDay: 0 },
};

/**
 * A part-done week — the case a week-level indicator gets half right.
 *
 * Days 1 and 2 are settled and say so in the shipped words; the labelled seam
 * marks where editing begins. Note that "In progress" sits ABOVE the seam: an
 * unfinished session's sets were written when it started, so it is as settled
 * as a finished one. Nothing is dimmed and nothing says "locked".
 */
export const SplitWeekWithSeam: Story = {
  args: {
    ...base,
    days: [
      { ...days[0], trained: "done" },
      { ...days[1], trained: "in-progress" },
      { ...days[2], trained: null },
    ],
    seamIndex: 2,
  },
};

/**
 * Settled days that are NOT contiguous. No single rule could say "everything
 * below this line is editable" without lying about day 3, so `trainedSeamIndex`
 * returns null and the words on the rows carry the boundary alone.
 */
export const SplitWeekNoHonestSeam: Story = {
  args: {
    ...base,
    days: [
      { ...days[0], trained: "done" },
      { ...days[1], trained: null },
      { ...days[2], trained: "done" },
    ],
    seamIndex: null,
  },
};

/** A past week's untouched days — the only place "Skipped" may be said. */
export const PastWeekSkipped: Story = {
  args: {
    ...base,
    selectedWeek: 1,
    days: [
      { ...days[0], trained: "done" },
      { ...days[1], trained: "skipped" },
      { ...days[2], trained: "skipped" },
    ],
  },
};
