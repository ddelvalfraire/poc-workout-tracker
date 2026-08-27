import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { EditorSetForm } from "./editor-set-form";
import type { EditorSet } from "./editor-model";

/**
 * One editable set — the INPUT side of the settled/editable boundary.
 *
 * Read this beside EditorDayPane's Trained stories: those render the same
 * values as text. The difference in FORM is the encoding, and it is structural
 * rather than a difference in lightness, which under 3:1 would not be a
 * distinction at all.
 *
 * Nothing here is ever `disabled` to mean "already trained". A settled set is
 * simply not rendered by this component: disabling would drop it out of the tab
 * order and invite the inactive-component contrast exemption, and it would also
 * promise that doing something makes the field available again, which is false.
 */
const meta = {
  title: "Editor/EditorSetForm",
  component: EditorSetForm,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EditorSetForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const set: EditorSet = {
  setNumber: 1,
  setType: "working",
  load: 100,
  repMin: 3,
  repMax: 5,
  rir: 2,
  rpe: null,
  overridden: false,
};

const base = {
  set,
  programId: "00000000-0000-0000-0000-000000000000",
  day: 0,
  exercise: 1,
  week: 3,
  unit: "kg" as const,
  action: () => {},
};

/** The ordinary row. */
export const Default: Story = { args: base };

/** Pounds — the field label carries the unit, and the action converts. */
export const Pounds: Story = {
  args: { ...base, unit: "lb", set: { ...set, load: 225 } },
};

/**
 * A set with nothing prescribed. The fields are blank rather than zeroed, and
 * blank stays blank on save: an empty box CLEARS that field's override, it does
 * not write "0 reps".
 */
export const NothingPrescribed: Story = {
  args: {
    ...base,
    set: { ...set, load: null, repMin: null, repMax: null, rir: null },
  },
};

/** A fixed rep target rather than a range. */
export const FixedReps: Story = {
  args: { ...base, set: { ...set, setNumber: 2, repMin: 5, repMax: 5 } },
};
