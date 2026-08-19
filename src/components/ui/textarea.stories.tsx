import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Textarea } from "./textarea";

/**
 * Multi-line field. Same treatment as `Input` (16px type to defeat iOS
 * tap-zoom), but `min-h-11` instead of a fixed height so content can grow it.
 * `resize-none` — a drag handle is a desktop affordance with no touch analogue.
 */
const meta = {
  title: "UI/Textarea",
  component: Textarea,
  parameters: { layout: "padded" },
  args: { placeholder: "How did the session feel?" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { rows: 3 } }

export const WithValue: Story = {
  args: {
    rows: 4,
    defaultValue:
      "Felt strong off the chest. Left shoulder tight on the last set — drop to 3 sets next week.",
  },
}

export const Disabled: Story = {
  args: { rows: 3, disabled: true, defaultValue: "Read-only note" },
}

export const Invalid: Story = { args: { rows: 3, "aria-invalid": true } }

/** Collapsed to its floor — one line tall until the user writes more. */
export const SingleRow: Story = { args: { rows: 1 } }
