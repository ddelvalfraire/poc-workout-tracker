import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import type { PivotCell, PivotRow } from "@/app/programs/[id]/editor/pivot-view";
import { EditorPivotGrid } from "./editor-pivot-grid";
import type { EditorWeek } from "./editor-model";

/**
 * Pane 2's exercise-wise face — one row per movement, one column per week.
 *
 * What to check here:
 *
 *  - The DERIVED cells are not dimmed. They are the unmarked default at full
 *    contrast; pinned cells carry a leading rule. Lightness alone measured
 *    2.27:1 against the 3:1 WCAG 1.4.1 asks of a non-colour distinction, which
 *    is why the channel is position instead.
 *  - A cell that is both pinned and focused shows the rail AND the ring. They
 *    are different geometry, so nothing has to arbitrate between them.
 *  - Mixed sets never collapse into an invented rep target. See MixedSets.
 *  - The unit appears once, in the corner, never per cell.
 */
const meta = {
  title: "Editor/EditorPivotGrid",
  component: EditorPivotGrid,
  parameters: { layout: "padded" },
} satisfies Meta<typeof EditorPivotGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

const weeks: EditorWeek[] = [
  { week: 1, isDeload: false, isBeyondBlock: false },
  { week: 2, isDeload: false, isBeyondBlock: false },
  { week: 3, isDeload: false, isBeyondBlock: false },
  { week: 4, isDeload: true, isBeyondBlock: false },
  { week: 5, isDeload: false, isBeyondBlock: false },
  { week: 6, isDeload: false, isBeyondBlock: false },
];

const cell = (patch: Partial<PivotCell> & { week: number }): PivotCell => ({
  setCount: 3,
  repMin: 8,
  repMax: 8,
  repsUniform: true,
  loadLow: 80,
  loadHigh: 80,
  pinned: false,
  ...patch,
});

/** A movement that climbs, dipping in the deload week. */
const climbing = (name: string, position: number, start: number, step: number): PivotRow => ({
  position,
  name,
  cells: weeks.map((entry) => {
    const load = entry.isDeload ? start * 0.75 : start + step * (entry.week - 1);
    return cell({
      week: entry.week,
      setCount: entry.isDeload ? 2 : 3,
      loadLow: load,
      loadHigh: load,
    });
  }),
});

/** Marks one week of a row as pinned by hand, at the load the user wrote. */
const pinAt = (row: PivotRow, week: number, load: number): PivotRow => ({
  ...row,
  cells: row.cells.map((entry) =>
    entry.week === week ? { ...entry, pinned: true, loadLow: load, loadHigh: load } : entry,
  ),
});

const rows: PivotRow[] = [
  climbing("Weighted Pull-Up", 0, 7.5, 2.5),
  // Week 2 pinned by hand — the state the whole design rests on: authored, and
  // NOT the cell you are currently editing.
  pinAt(climbing("Barbell Row", 1, 75, 2.5), 2, 80),
  pinAt(climbing("Lat Pulldown", 2, 55, 2.5), 5, 67.5),
  climbing("Cable Face Pull", 3, 25, 1.25),
];

const base = {
  dayName: "Pull",
  weeks,
  rows,
  selectedWeek: 3,
  selectedExercise: null,
  hrefForCell: (exercise: number, week: number) =>
    `/programs/p1/editor/0?week=${week}&exercise=${exercise}&view=exercise`,
  unit: "kg" as const,
};

/** The ordinary grid: two hand-pinned weeks among four derived rows. */
export const Default: Story = { args: base };

/**
 * A cell that is BOTH pinned and being edited — rail inside, ring around.
 *
 * This is the pairing the encoding exists for. Had authored-ness been a
 * saturation step, the focus treatment would have had to fight it for the same
 * channel; as geometry, the two simply coexist.
 */
export const FocusedOnAPin: Story = {
  args: { ...base, selectedWeek: 2, selectedExercise: 1 },
};

/**
 * Sets that DISAGREE inside one week.
 *
 * A warmup, two working sets and a back-off is an ordinary exercise, and
 * "3×8 @ 80" would state a prescription nobody wrote. The cell prints the count
 * and a load spread instead — less information, none of it invented.
 */
export const MixedSets: Story = {
  args: {
    ...base,
    rows: [
      {
        position: 0,
        name: "Back Squat",
        cells: weeks.map((entry) =>
          cell({
            week: entry.week,
            setCount: 4,
            repMin: null,
            repMax: null,
            repsUniform: false,
            loadLow: 60,
            loadHigh: 100,
          }),
        ),
      },
      {
        position: 1,
        name: "Romanian Deadlift",
        cells: weeks.map((entry) => cell({ week: entry.week, repMin: 8, repMax: 12 })),
      },
    ],
  },
};

/**
 * A block shortened below the weeks it was trained into.
 *
 * Weeks 5–6 are real sessions sitting past the block's end. They are listed and
 * SAID to be past it — anything looping `1..mesocycleWeeks` would drop them from
 * the grid, which is the documented way to make real training invisible.
 */
export const ShrunkBelowTrained: Story = {
  args: {
    ...base,
    weeks: [
      { week: 1, isDeload: false, isBeyondBlock: false },
      { week: 2, isDeload: false, isBeyondBlock: false },
      { week: 3, isDeload: false, isBeyondBlock: false },
      { week: 4, isDeload: true, isBeyondBlock: false },
      { week: 5, isDeload: false, isBeyondBlock: true },
      { week: 6, isDeload: false, isBeyondBlock: true },
    ],
  },
};

/** Pounds — loads arrive converted, and the unit is still declared once. */
export const Pounds: Story = {
  args: { ...base, unit: "lb", rows: [climbing("Barbell Row", 0, 165, 5)] },
};

/** An exercise with no working sets keeps its row rather than leaving a hole. */
export const NothingPrescribed: Story = {
  args: {
    ...base,
    rows: [
      {
        position: 0,
        name: "Mobility Flow",
        cells: weeks.map((entry) =>
          cell({
            week: entry.week,
            setCount: 0,
            repMin: null,
            repMax: null,
            loadLow: null,
            loadHigh: null,
          }),
        ),
      },
    ],
  },
};

/** A day with no exercises to compare. */
export const Empty: Story = { args: { ...base, rows: [] } };

/** No day addressed — the wide layout's empty canvas. */
export const Unaddressed: Story = { args: { ...base, dayName: null } };
