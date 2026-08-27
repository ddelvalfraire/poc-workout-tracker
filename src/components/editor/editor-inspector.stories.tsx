import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { EditorInspector } from "./editor-inspector";

/**
 * Pane 3 — the inspector for the selected exercise.
 *
 * The same markup is a bottom sheet on phone and a 316px column at width;
 * `EditorPanes` owns which. Copy that needs deriving (the scheme sentence,
 * technique labels) arrives ALREADY localized from the server, so this surface
 * and the program detail page cannot describe the same scheme two ways.
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

const base = {
  closeHref: "?",
  exercise: {
    position: 0,
    name: "Barbell Bench Press",
    setCount: 3,
    progressionSentence: "Add 2.5 kg when you hit the top of the rep range.",
    techniques: [],
  },
};

/** The ordinary case: a progression, no intensity technique. */
export const Default: Story = { args: base };

/** Sets carrying techniques, labelled with the detail page's shipped words. */
export const WithTechniques: Story = {
  args: {
    ...base,
    exercise: {
      ...base.exercise,
      setCount: 4,
      techniques: [
        { setNumber: 3, label: "Drop set" },
        { setNumber: 4, label: "Myo-reps" },
      ],
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
