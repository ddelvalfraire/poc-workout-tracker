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
  { position: 0, name: "Push", exerciseCount: 5 },
  { position: 1, name: "Pull", exerciseCount: 5 },
  { position: 2, name: "Legs", exerciseCount: 4 },
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
