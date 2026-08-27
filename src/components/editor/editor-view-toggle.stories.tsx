import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { EditorViewToggle } from "./editor-view-toggle";

/**
 * The reading pane 2 renders the block in.
 *
 * Both options are LINKS to the same address with one param changed, so Back
 * undoes a switch and a shared URL arrives in the reading it was shared from.
 * The current option carries `aria-current`, which is what puts the state in
 * the accessibility tree rather than leaving it to the fill colour.
 */
const meta = {
  title: "Editor/EditorViewToggle",
  component: EditorViewToggle,
  parameters: { layout: "padded" },
  args: {
    hrefForView: (view: string) => `/programs/p1/editor/0?view=${view}`,
  },
} satisfies Meta<typeof EditorViewToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default reading — one day, one week. */
export const ByDay: Story = { args: { view: "day" } };

/** The pivot — one day, every week. */
export const ByExercise: Story = { args: { view: "exercise" } };
