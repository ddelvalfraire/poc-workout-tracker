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

/**
 * Enter COMMITS, and hands focus back.
 *
 * The stopping-before-commit version of this test is why the field shipped
 * dropping focus on `<body>`: the input unmounts while it still holds focus,
 * so unless the button that replaces it takes focus deliberately, a keyboard
 * user is dumped at the top of the document (WCAG 2.4.3).
 */
export const EnterCommits: Story = {
  args: {
    value: "",
    onValueChange: () => {},
    placeholder: "Untitled block",
    label: "Program name",
  },
  render: () => <Controlled initial="" />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole("button", { name: "Program name" });

    await step("type a name and commit it", async () => {
      await userEvent.click(heading);
      const field = await canvas.findByRole("textbox", { name: "Program name" });
      await userEvent.type(field, "Hypertrophy A");
      await userEvent.keyboard("{Enter}");
    });

    await step("the typed name is kept, and focus is back on the heading", async () => {
      const committed = await canvas.findByRole("button", { name: "Program name" });
      await expect(committed).toHaveTextContent("Hypertrophy A");
      await expect(committed).toHaveFocus();
      await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
    });
  },
};

/**
 * Escape CANCELS — it reverts to the value the field opened with. It used to
 * commit, which made the two keys synonyms and left no way out of a mistyped
 * name but to retype the old one.
 */
export const EscapeCancels: Story = {
  args: {
    value: "Volume Cut · Block 3",
    onValueChange: () => {},
    placeholder: "Untitled block",
    label: "Program name",
  },
  render: () => <Controlled initial="Volume Cut · Block 3" />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("type over the existing name, then abandon it", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Program name" }));
      const field = await canvas.findByRole("textbox", { name: "Program name" });
      await userEvent.clear(field);
      await userEvent.type(field, "Wrong name");
      await expect(field).toHaveValue("Wrong name");
      await userEvent.keyboard("{Escape}");
    });

    await step("the pre-edit name is back, and so is focus", async () => {
      const heading = await canvas.findByRole("button", { name: "Program name" });
      await expect(heading).toHaveTextContent("Volume Cut · Block 3");
      await expect(heading).not.toHaveTextContent("Wrong name");
      await expect(heading).toHaveFocus();
    });
  },
};

/** The heading stays a heading in BOTH states — the outline never loses it. */
export const HeadingSurvivesEditing: Story = {
  args: {
    value: "Volume Cut · Block 3",
    onValueChange: () => {},
    placeholder: "Untitled block",
    label: "Program name",
  },
  render: () => <Controlled initial="Volume Cut · Block 3" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 2 })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Program name" }));
    await canvas.findByRole("textbox", { name: "Program name" });
    await expect(canvas.getByRole("heading", { level: 2 })).toBeInTheDocument();
  },
};
