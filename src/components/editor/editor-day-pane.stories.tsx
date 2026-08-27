import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { EditorDayPane } from "./editor-day-pane";
import type { EditorDayDetail, EditorSet } from "./editor-model";

/**
 * Pane 2 — the addressed day and the sets it prescribes for the selected week.
 *
 * Selecting an exercise is a link to the same address with `?exercise=` set, so
 * one href opens the sheet on phone and pane 3 at width. Selection here reads
 * as a rule plus weight, never the accent: the volt is spent on the selected
 * day in pane 1.
 */
const meta = {
  title: "Editor/EditorDayPane",
  component: EditorDayPane,
  parameters: { layout: "padded" },
} satisfies Meta<typeof EditorDayPane>;

export default meta;
type Story = StoryObj<typeof meta>;

const set = (patch: Partial<EditorSet> & { setNumber: number }): EditorSet => ({
  setType: "working",
  load: 100,
  repMin: 3,
  repMax: 5,
  rir: 2,
  rpe: null,
  overridden: false,
  ...patch,
});

const day: EditorDayDetail = {
  position: 0,
  name: "Push",
  exerciseCount: 2,
  exercises: [
    {
      position: 0,
      name: "Barbell Bench Press",
      sets: [set({ setNumber: 1 }), set({ setNumber: 2 }), set({ setNumber: 3 })],
    },
    {
      position: 1,
      name: "Overhead Press",
      sets: [
        set({ setNumber: 1, load: 50, repMin: 8, repMax: 8 }),
        set({ setNumber: 2, load: 50, repMin: 8, repMax: 8 }),
      ],
    },
  ],
};

const base = {
  day,
  week: 3,
  unit: "kg" as const,
  selectedExercise: null,
  hrefForExercise: (exercise: number) => `?exercise=${exercise}`,
};

/** The ordinary case: a day, its exercises, and the week's numbers. */
export const Default: Story = { args: base };

/** With an exercise inspected — a rule and weight, no second accent. */
export const ExerciseSelected: Story = { args: { ...base, selectedExercise: 0 } };

/**
 * A week whose sets carry per-week overrides. The override is announced in
 * words on the row, not as a chip: it is metadata, and pill styling would claim
 * it is pressable.
 */
export const WithWeekOverrides: Story = {
  args: {
    ...base,
    day: {
      ...day,
      exercises: [
        {
          ...day.exercises[0],
          sets: [
            set({ setNumber: 1, load: 90, overridden: true }),
            set({ setNumber: 2, load: 90, overridden: true }),
            set({ setNumber: 3 }),
          ],
        },
        day.exercises[1],
      ],
    },
  },
};

/** Pounds — loads arrive already converted; the pane never converts. */
export const Pounds: Story = {
  args: { ...base, unit: "lb", day: { ...day, exercises: [day.exercises[0]] } },
};

/** A set the template leaves blank says so rather than rendering an empty row. */
export const SetWithNothingPrescribed: Story = {
  args: {
    ...base,
    day: {
      ...day,
      exerciseCount: 1,
      exercises: [
        {
          position: 0,
          name: "Barbell Bench Press",
          sets: [
            set({ setNumber: 1 }),
            {
              setNumber: 2,
              setType: "working",
              load: null,
              repMin: null,
              repMax: null,
              rir: null,
              rpe: null,
              overridden: false,
            },
          ],
        },
      ],
    },
  },
};

/** A day with no exercises yet — plain words. */
export const NoExercises: Story = {
  args: { ...base, day: { position: 1, name: "Pull", exerciseCount: 0, exercises: [] } },
};

/**
 * No day addressed. Only the wide projection ever renders this — on phone the
 * structure list occupies the column instead — so it is an invitation, not an
 * apology.
 */
export const EmptyCanvas: Story = { args: { ...base, day: null } };
