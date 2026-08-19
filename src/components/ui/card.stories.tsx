import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "./button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

/**
 * The card primitive — **keep-list only** (DESIGN.md).
 *
 * Card shells stay where the shell IS the meaning: sheets, dialogs and
 * popovers (elevation is the point of an overlay), coach chat bubbles,
 * StatTile, content-preview clippings, media tiles. Everywhere else, a list or
 * detail surface sits on the page background with hairline dividers — reach
 * for `Section` + `DividerList`, not this.
 *
 * `eslint.config.mjs` enforces that split: `rounded-2xl` and `bg-card` are
 * banned outside the keep-list and the shrinking grandfather ratchet.
 */
const meta = {
  title: "UI/Card",
  component: Card,
  parameters: { layout: "padded" },
  argTypes: { size: { control: "inline-radio", options: ["default", "sm"] } },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>Push day</CardTitle>
          <CardDescription>6 exercises · ~52 min</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          Bench press, incline dumbbell press, overhead press, lateral raise,
          triceps pushdown, overhead extension.
        </CardContent>
      </>
    ),
  },
}

/** `sm` tightens `--card-spacing` and shrinks the title. */
export const Small: Story = {
  args: {
    size: "sm",
    children: (
      <>
        <CardHeader>
          <CardTitle>Rest timer</CardTitle>
          <CardDescription>90 seconds</CardDescription>
        </CardHeader>
      </>
    ),
  },
}

/** `CardAction` occupies the header's second column. */
export const WithAction: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>Upper / Lower</CardTitle>
          <CardDescription>4 days per week</CardDescription>
          <CardAction>
            <Button size="sm" variant="ghost">
              Edit
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          Next session: Upper A
        </CardContent>
      </>
    ),
  },
}

/** A footer gets the muted band and removes the card's bottom padding. */
export const WithFooter: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>Delete program?</CardTitle>
          <CardDescription>This cannot be undone.</CardDescription>
        </CardHeader>
        <CardFooter className="gap-2">
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
          <Button variant="destructive" size="sm">
            Delete
          </Button>
        </CardFooter>
      </>
    ),
  },
}

/** Full anatomy, for the autodocs prop table. */
export const AllSlots: Story = {
  args: {
    children: (
      <>
        <CardHeader>
          <CardTitle>CardTitle</CardTitle>
          <CardDescription>CardDescription</CardDescription>
          <CardAction>
            <Button size="xs" variant="outline">
              Action
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="text-muted-foreground">CardContent</CardContent>
        <CardFooter className="text-muted-foreground">CardFooter</CardFooter>
      </>
    ),
  },
}
