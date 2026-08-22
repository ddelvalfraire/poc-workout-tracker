import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { EditableTitle } from "./editable-title";

/**
 * The program title at the top of the builder: a display heading that becomes a
 * field when pressed.
 *
 * A labelled text input at the top of the form would read as a naming GATE, and
 * naming a training block is the last thing anyone knows. Muted placeholder
 * text says "unfilled slot" without demanding it be filled, and nothing is
 * autofocused — focus belongs on the work.
 */
const meta = {
  title: "ProgramForm/EditableTitle",
  component: EditableTitle,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EditableTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  return (
    <EditableTitle
      value={name}
      onValueChange={setName}
      placeholder="Untitled block"
      label="Program name"
    />
  );
}

/** A new program: the title is the only thing on screen that says "new". */
export const Untitled: Story = {
  args: {
    value: "",
    onValueChange: () => {},
    placeholder: "Untitled block",
    label: "Program name",
  },
  render: () => <Controlled initial="" />,
};

/** An existing block. */
export const Named: Story = {
  args: {
    value: "Volume Cut · Block 3",
    onValueChange: () => {},
    placeholder: "Untitled block",
    label: "Program name",
  },
  render: () => <Controlled initial="Volume Cut · Block 3" />,
};

/** A long name truncates rather than wrapping the header into two lines. */
export const LongName: Story = {
  args: {
    value: "Volume Cut · Block 3 · Upper/Lower with accessory emphasis",
    onValueChange: () => {},
    placeholder: "Untitled block",
    label: "Program name",
  },
  render: () => <Controlled initial="Volume Cut · Block 3 · Upper/Lower with accessory emphasis" />,
};

/** Pressing the heading swaps it for a field carrying the SAME accessible name. */
export const PressToEdit: Story = {
  args: {
    value: "",
    onValueChange: () => {},
    placeholder: "Untitled block",
    label: "Program name",
  },
  render: () => <Controlled initial="" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Program name" }));
    const field = await canvas.findByRole("textbox", { name: "Program name" });
    await expect(field).toHaveFocus();
    await userEvent.type(field, "Hypertrophy A");
    await expect(field).toHaveValue("Hypertrophy A");
  },
};
