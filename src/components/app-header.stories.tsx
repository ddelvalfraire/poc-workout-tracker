import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Plus } from "lucide-react";

import { AppHeader } from "./app-header";
import { BackLink } from "./back-link";
import { Button } from "./ui/button";

/**
 * The sticky top app bar — the native nav-bar pattern (DESIGN.md § Components).
 *
 * Pads for the status-bar safe area in standalone mode (`pt-safe`) and keeps a
 * translucent, blurred surface so content reads as scrolling *under* it. The
 * title uses the display font via the `h1` base rule and truncates rather than
 * wrapping — a two-line app bar shifts every screen below it.
 */
const meta = {
  title: "Components/AppHeader",
  component: AppHeader,
  parameters: { layout: "fullscreen" },
  args: { title: "History" },
} satisfies Meta<typeof AppHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Scrollable body included so the translucent blur has something to sit over. */
const withScrollingBody = (Story: React.ComponentType) => (
  <div className="min-h-[100dvh] bg-background">
    <Story />
    <div className="mx-auto w-full max-w-md px-5">
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 border-b border-b-border/60 py-4"
        >
          <span>Session {12 - i}</span>
          <span className="text-muted-foreground">{18 + i} sets</span>
        </div>
      ))}
    </div>
  </div>
);

export const Default: Story = { decorators: [withScrollingBody] }

/** With a back affordance in the leading slot. */
export const WithBackLink: Story = {
  args: {
    title: "Bench press",
    leading: <BackLink fallback="/exercises" />,
  },
  decorators: [withScrollingBody],
}

/** Trailing slot: a cancel link, an account button, an add action. */
export const WithTrailingAction: Story = {
  args: {
    title: "Programs",
    trailing: (
      <Button size="icon-sm" variant="ghost" aria-label="New program">
        <Plus />
      </Button>
    ),
  },
  decorators: [withScrollingBody],
}

export const BothSlots: Story = {
  args: {
    title: "Edit program",
    leading: <BackLink fallback="/programs" />,
    trailing: (
      <Button size="sm" variant="ghost">
        Cancel
      </Button>
    ),
  },
  decorators: [withScrollingBody],
}

/** A long title truncates — it never wraps to a second line. */
export const LongTitle: Story = {
  args: {
    title: "Romanian deadlift with a deficit",
    leading: <BackLink fallback="/exercises" />,
    trailing: (
      <Button size="sm" variant="ghost">
        Edit
      </Button>
    ),
  },
  decorators: [withScrollingBody],
}
