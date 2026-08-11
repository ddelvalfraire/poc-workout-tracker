import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "./button";

/**
 * The app's one button shape (DESIGN.md § Components). `default` and `lg` are
 * ≥44px tall so primary actions clear the HIG touch target; `xs`/`sm`/`icon-*`
 * stay for inline affordances like remove-set.
 */
const meta = {
  title: "UI/Button",
  component: Button,
  args: { children: "Start workout" },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "outline",
        "secondary",
        "ghost",
        "destructive",
        "link",
      ],
    },
    size: {
      control: "select",
      options: [
        "default",
        "xs",
        "sm",
        "lg",
        "icon",
        "icon-xs",
        "icon-sm",
        "icon-lg",
      ],
    },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {}

export const Outline: Story = { args: { variant: "outline" } }
export const Secondary: Story = { args: { variant: "secondary" } }
export const Ghost: Story = { args: { variant: "ghost" } }
export const Destructive: Story = {
  args: { variant: "destructive", children: "Remove set" },
}
export const Link: Story = { args: { variant: "link", children: "See all" } }

/** Every variant at the default size — the volt appears on `default` only. */
export const AllVariants: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="flex flex-col items-start gap-3">
      {(
        [
          "default",
          "outline",
          "secondary",
          "ghost",
          "destructive",
          "link",
        ] as const
      ).map((variant) => (
        <Button key={variant} {...args} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
}

/**
 * The full size ramp. `default` (44px) and `lg` (48px) are the touch-target
 * sizes; the rest are inline affordances.
 */
export const AllSizes: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="flex flex-col items-start gap-3">
      {(["xs", "sm", "default", "lg"] as const).map((size) => (
        <Button key={size} {...args} size={size}>
          {size}
        </Button>
      ))}
      <div className="flex items-center gap-3">
        {(["icon-xs", "icon-sm", "icon", "icon-lg"] as const).map((size) => (
          <Button key={size} {...args} size={size} aria-label={`Add (${size})`}>
            <Plus />
          </Button>
        ))}
      </div>
    </div>
  ),
}

/** The full variant × size matrix — the consistency check for the shape. */
export const Matrix: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <table className="border-separate border-spacing-3 text-left">
      <thead>
        <tr>
          <th className="text-xs font-normal text-muted-foreground">size \ variant</th>
          {(["default", "outline", "secondary", "ghost", "destructive"] as const).map(
            (variant) => (
              <th
                key={variant}
                className="text-xs font-normal text-muted-foreground"
              >
                {variant}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {(["xs", "sm", "default", "lg"] as const).map((size) => (
          <tr key={size}>
            <th className="text-xs font-normal text-muted-foreground">{size}</th>
            {(
              ["default", "outline", "secondary", "ghost", "destructive"] as const
            ).map((variant) => (
              <td key={variant}>
                <Button {...args} size={size} variant={variant}>
                  Save
                </Button>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}

export const Disabled: Story = { args: { disabled: true } }

/** Leading/trailing icon slots — `data-icon` tightens the matching padding. */
export const WithIcons: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="flex flex-col items-start gap-3">
      <Button {...args}>
        <Plus data-icon="inline-start" />
        Add exercise
      </Button>
      <Button {...args} variant="destructive">
        <Trash2 data-icon="inline-start" />
        Remove
      </Button>
      <Button {...args} size="icon" aria-label="Add exercise">
        <Plus />
      </Button>
    </div>
  ),
}

/** Primary actions are full-width and thumb-reachable (DESIGN.md § Components). */
export const FullWidthAction: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="w-[calc(100vw-2rem)] max-w-md">
      <Button {...args} size="lg" className="w-full">
        Save workout
      </Button>
    </div>
  ),
}
