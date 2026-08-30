import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AppHeader } from "./app-header";
import { BackLink } from "./back-link";

/**
 * The app's ONE back affordance — it replaces every hardcoded parent `<Link>`
 * chevron.
 *
 * It pops when the app owns the previous history entry and `replace()`s the
 * fallback on a cold deep-link entry — never a push, so the chevron and the
 * iOS edge-swipe walk the same stack and agree about where "back" goes.
 *
 * It is a `<button>`, not a link, and deliberately so: "back" has no stable
 * href to long-press, prefetch or open in a new tab, and pretending it does is
 * exactly how the old chevrons polluted the history stack.
 *
 * `fallback` is the canonical parent — where a COLD entry lands. In warm flows
 * it almost never fires.
 */
const meta = {
  title: "Components/BackLink",
  component: BackLink,
  args: { fallback: "/exercises" },
} satisfies Meta<typeof BackLink>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Icon only — the default, and what every app-bar uses. */
export const Default: Story = {}

/** With a label beside the chevron, for headers that name their back target. */
export const WithLabel: Story = {
  args: { children: <span className="pr-1">Exercises</span> },
}

/** A more specific accessible name than the default "Back". */
export const CustomAriaLabel: Story = {
  args: { "aria-label": "Back to exercises" },
}

/** In place — the `-ml-2` pulls the ghost button's box back to the edge. */
export const InAppHeader: Story = {
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <div className="min-h-[16rem] bg-background">
      <AppHeader title="Bench press" leading={<BackLink {...args} />} />
      <div className="mx-auto w-full max-w-md px-5 pt-6 text-muted-foreground">
        Press the chevron: in Storybook there is no app history, so it takes the
        cold-entry path and replaces with the fallback.
      </div>
    </div>
  ),
}
