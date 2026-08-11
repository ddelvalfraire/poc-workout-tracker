import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Input } from "./input";

/**
 * Form field (DESIGN.md keep-list — fields need enclosure).
 *
 * The two numbers that matter: `h-11` (44px, thumb-friendly) and `text-base`
 * (16px). 16px is not a style choice — anything smaller makes iOS Safari zoom
 * the viewport on focus. Never shrink a field's type to fit a layout.
 */
const meta = {
  title: "UI/Input",
  component: Input,
  parameters: { layout: "padded" },
  args: { placeholder: "Bench press" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {}

export const WithValue: Story = { args: { defaultValue: "Barbell squat" } }

export const Disabled: Story = { args: { disabled: true, defaultValue: "Locked" } }

/** `aria-invalid` drives the destructive border + ring — no extra prop needed. */
export const Invalid: Story = {
  args: { "aria-invalid": true, defaultValue: "-5" },
}

/** The logger's numeric fields. `inputMode` picks the right soft keyboard. */
export const Numeric: Story = {
  args: {
    type: "number",
    inputMode: "decimal",
    placeholder: "0",
    defaultValue: "82.5",
    "aria-label": "Weight",
  },
}

/** Labelled field — the shape every form on the app actually uses. */
export const Labelled: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <label htmlFor="sb-exercise" className="text-sm font-medium">
        Exercise
      </label>
      <Input {...args} id="sb-exercise" />
      <p className="text-sm text-muted-foreground">
        Search the library or type your own.
      </p>
    </div>
  ),
}

/** Focus ring: the volt, so keyboard focus is unmistakable. */
export const Focused: Story = {
  args: { autoFocus: true, defaultValue: "Focus ring" },
}
