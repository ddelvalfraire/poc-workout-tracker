import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { WorkoutLogger } from "./workout-logger";
import type { WorkoutDraft } from "./workout-draft";

/**
 * How a technique set READS in the logger (docs/TECHNIQUE-LOGGING.md,
 * "Model A"): one prescribed rest-pause or drop set is several rows — one per
 * stage — so the lifter records what actually happened at each drop.
 *
 * The rows say they are one set, not three: a shared left hairline (the
 * superset vocabulary — hairlines, never a shell), the technique's glyph in
 * the circle instead of a set number, and no rest period between stages.
 */
function exercise(sets: WorkoutDraft["exercises"][number]["sets"]) {
  return {
    id: "ex1",
    wgerExerciseId: 73,
    source: "wger" as const,
    name: "Lat Pulldown",
    category: "Back",
    loggingType: "weight_reps" as const,
    notes: "",
    skipped: false,
    sets,
  };
}

const set = (
  id: string,
  reps: string,
  weight: string,
  technique?: { kind: "drop-set" | "rest-pause"; group: string; stageIndex: number },
) => ({ id, reps, weight, completed: false, tag: "working" as const, ...(technique && { technique }) });

const meta = {
  title: "Logger/Technique rows",
  component: WorkoutLogger,
  parameters: { layout: "fullscreen", a11y: { test: "todo" } },
  args: { title: "Pull A", closeHref: "/" },
} satisfies Meta<typeof WorkoutLogger>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A straight working set followed by a three-stage drop set. */
export const DropSet: Story = {
  args: {
    initialDraft: {
      notes: "",
      exercises: [
        exercise([
          set("s1", "10", "60"),
          set("s2", "10", "60", { kind: "drop-set", group: "g1", stageIndex: 0 }),
          set("s3", "6", "45", { kind: "drop-set", group: "g1", stageIndex: 1 }),
          set("s4", "4", "30", { kind: "drop-set", group: "g1", stageIndex: 2 }),
        ]),
      ],
    },
  },
};

/** A rest-pause set: the top set plus two mini-sets after a ~20 s pause. */
export const RestPause: Story = {
  args: {
    initialDraft: {
      notes: "",
      exercises: [
        exercise([
          set("s1", "8", "70", { kind: "rest-pause", group: "g1", stageIndex: 0 }),
          set("s2", "3", "70", { kind: "rest-pause", group: "g1", stageIndex: 1 }),
          set("s3", "2", "70", { kind: "rest-pause", group: "g1", stageIndex: 2 }),
        ]),
      ],
    },
  },
};

/** The same exercise with no technique — the baseline the rows depart from. */
export const Ordinary: Story = {
  args: {
    initialDraft: {
      notes: "",
      exercises: [exercise([set("s1", "10", "60"), set("s2", "10", "60"), set("s3", "10", "60")])],
    },
  },
};
