import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Repeat } from "lucide-react";

import { GuardedStartLink } from "./guarded-start-link";
import { buttonVariants } from "../ui/button";

/**
 * A "start a new workout" affordance that respects the single-active-session
 * rule.
 *
 * With no live session it is a plain `<Link>` — which keeps prefetch,
 * middle-click and long-press previews, everything a `<button onClick={push}>`
 * would throw away. With a live session it becomes a button that raises the
 * conflict dialog, and only a confirmed discard lets the original navigation
 * through.
 *
 * The caller supplies `className` (usually `buttonVariants(...)`), so guarded
 * and unguarded renders are visually **identical**: the guard is behaviour,
 * not chrome. Toggle the `session` control below and watch nothing change
 * until you press.
 */
const meta = {
  title: "Components/GuardedStartLink",
  component: GuardedStartLink,
  parameters: { layout: "padded" },
  args: {
    href: "/workout/new",
    session: null,
    className: buttonVariants({ size: "lg" }),
    children: "Start workout",
  },
} satisfies Meta<typeof GuardedStartLink>;

export default meta;
type Story = StoryObj<typeof meta>;

const LIVE_SESSION = {
  key: "new",
  name: "Push day",
  setCount: 18,
  completedSetCount: 7,
};

/** No live session: a real link, no ceremony. */
export const Unguarded: Story = {}

/** A live session: same pixels, but pressing raises the conflict dialog. */
export const Guarded: Story = { args: { session: LIVE_SESSION } }

/** Full-width primary action, as it appears on home. */
export const FullWidth: Story = {
  args: {
    session: LIVE_SESSION,
    className: `${buttonVariants({ size: "lg" })} w-full`,
  },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
}

/** Icon-only start — the history Repeat button. Both renders keep the label. */
export const IconOnly: Story = {
  args: {
    session: LIVE_SESSION,
    className: buttonVariants({ size: "icon-sm", variant: "ghost" }),
    "aria-label": "Repeat this workout",
    children: <Repeat />,
  },
}

/** Guarded and unguarded side by side — the point is that they match. */
export const GuardIsInvisible: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          No live session
        </p>
        <GuardedStartLink {...args} session={null} />
      </div>
      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          Live session
        </p>
        <GuardedStartLink {...args} session={LIVE_SESSION} />
      </div>
    </div>
  ),
}
