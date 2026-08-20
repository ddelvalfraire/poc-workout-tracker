import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SetRowMenu } from "./set-row-menu";

/**
 * The set-row long-press menu — and, since intensity techniques landed, the
 * app's SET-TYPE PICKER: warm-up plus drop set / rest-pause / myo-reps /
 * cluster, each item a toggle back to an ordinary set.
 *
 * The technique arm follows Hevy's grammar: a technique is a property of the
 * ROW, and a stage CONTINUES the set above it — so tagging set 2 as a drop
 * set pulls set 1 into the group as its top set, and the items don't render
 * at all on an exercise's first set (`canTagTechnique: false`).
 *
 * The menu is fixed-positioned at the press point; these stories pin it at a
 * fixed coordinate so the catalog frame shows the whole popover.
 */
const meta = {
  title: "Logger/SetRowMenu",
  component: SetRowMenu,
  parameters: { layout: "fullscreen" },
  args: {
    x: 24,
    y: 24,
    setLabel: "set 2 of Squat",
    hasNote: false,
    isWarmup: false,
    techniqueKind: null,
    canTagTechnique: true,
    onNote: () => {},
    onTagWarmup: () => {},
    onTagTechnique: () => {},
    onRemove: () => {},
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div className="h-[420px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SetRowMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An ordinary working set: note, warm-up, the four techniques, remove. */
export const Default: Story = {};

/** The row is already a drop-set stage — its item is checked and offers the
 *  way back, exactly like the warm-up item does. */
export const TaggedDropSet: Story = {
  args: { techniqueKind: "drop-set", setLabel: "drop set stage 2 of set 2 of Squat" },
};

/** An exercise's FIRST set: no technique items, because a stage continues the
 *  set above it and there is none. */
export const FirstSet: Story = {
  args: { canTagTechnique: false, setLabel: "set 1 of Squat" },
};

/** A warm-up row that already carries a note — both items flip their copy. */
export const WarmupWithNote: Story = {
  args: { isWarmup: true, hasNote: true, setLabel: "warm-up set 1 of Squat" },
};
