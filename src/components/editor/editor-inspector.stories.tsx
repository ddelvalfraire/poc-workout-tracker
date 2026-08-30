import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { fn } from "storybook/test";

import { EditorInspector } from "./editor-inspector";
import type { DerivedSet } from "@/lib/programs/progression";

/**
 * Pane 3 — the inspector for the selected exercise.
 *
 * The same markup is a bottom sheet on phone and a 316px column at width;
 * `EditorPanes` owns which. The scheme sentence arrives ALREADY localized from
 * the server, so this surface and the program detail page cannot describe the
 * same scheme two ways.
 *
 * The technique section used to be a list of labels — correct, and
 * unactionable. It is now the write path: one stack per set, since a technique
 * belongs to a set rather than to an exercise.
 *
 * Closing is a LINK, not a button: the inspector's open-ness is part of the
 * address, so Back has to undo it.
 */
const meta = {
  title: "Editor/EditorInspector",
  component: EditorInspector,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      // The token width (`editor-inspector-width`, 316).
      <div className="w-[min(316px,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EditorInspector>;

export default meta;
type Story = StoryObj<typeof meta>;

const derivedSet = (setNumber: number, loadKg: number | null): DerivedSet => ({
  setNumber,
  setType: "working",
  metricMode: "reps_weight",
  repMin: 8,
  repMax: 8,
  rir: null,
  rpe: null,
  loadKg,
  tempo: null,
  durationSec: null,
  distanceM: null,
  restSec: 180,
  technique: null,
  derivedFrom: "template",
  sourceIndex: setNumber - 1,
});

const base = {
  closeHref: "?",
  programId: "0f1c8a2e-4d3b-4a55-9f77-0a1b2c3d4e5f",
  day: 0,
  unit: "kg" as const,
  saveTechnique: fn(),
  exercise: {
    position: 0,
    name: "Barbell Bench Press",
    setCount: 3,
    progressionSentence: "Add 2.5 kg when you hit the top of the rep range.",
    editableSets: [
      { setNumber: 1, technique: null, label: null, topSet: derivedSet(1, 100) },
      { setNumber: 2, technique: null, label: null, topSet: derivedSet(2, 100) },
    ],
  },
};

/** The ordinary case: a progression, no intensity technique. */
export const Default: Story = { args: base };

/** Sets that already carry a stack open on it, rather than on an empty form. */
export const WithTechniques: Story = {
  args: {
    ...base,
    exercise: {
      ...base.exercise,
      setCount: 2,
      editableSets: [
        {
          setNumber: 1,
          technique: { version: 1, kind: "drop-set", stages: [{ reps: 6, loadPct: 0.8 }] },
          label: "Drop set",
          topSet: derivedSet(1, 100),
        },
        {
          setNumber: 2,
          technique: { version: 1, kind: "myo-reps", stages: [{ reps: 5, restSec: 15 }] },
          label: "Myo-reps",
          topSet: derivedSet(2, 100),
        },
      ],
    },
  },
};

/**
 * A week with no derivation for the set: listed, not editable. A percentage
 * stage resolves against the derived top set, so a form without one could only
 * guess at the weight it would prescribe.
 */
export const NoDerivationForTheWeek: Story = {
  args: {
    ...base,
    exercise: {
      ...base.exercise,
      setCount: 1,
      editableSets: [{ setNumber: 1, technique: null, label: null, topSet: null }],
    },
  },
};

/** No progression set — the section says so rather than inventing copy. */
export const NoProgression: Story = {
  args: { ...base, exercise: { ...base.exercise, progressionSentence: null } },
};

/** A long exercise name has to truncate rather than widen the fixed column. */
export const LongName: Story = {
  args: {
    ...base,
    exercise: {
      ...base.exercise,
      name: "Close-Grip Incline Barbell Bench Press (Slingshot)",
    },
  },
};
