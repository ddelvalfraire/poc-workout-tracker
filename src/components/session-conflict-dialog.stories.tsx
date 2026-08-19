import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { SessionConflictDialog } from "./session-conflict-dialog";

/**
 * The bottom sheet shown when starting a NEW workout would collide with a
 * live one. One session at a time is the product rule — two live drafts fight
 * over the home banner and the lifter's attention.
 *
 * **Continue is the volt action**: protecting already-logged work is the happy
 * path. Discard wears destructive tokens, and only after a successful discard
 * does the caller's original "start" intent run via `onProceed`.
 *
 * The guard lives on the START AFFORDANCES (home CTAs, Repeat, program Start),
 * not on the `/workout/new` route — guarding the route would need a redirect
 * or an interstitial on every logger mount, taxing the common path for a
 * corner case.
 *
 * The discard action is stubbed here (`.storybook/mocks/app-actions.ts`).
 */
const meta = {
  title: "Components/SessionConflictDialog",
  component: SessionConflictDialog,
  parameters: { layout: "fullscreen" },
  args: {
    session: {
      key: "new",
      name: "Push day",
      setCount: 18,
      completedSetCount: 7,
    },
    onClose: fn(),
    onProceed: fn(),
  },
  decorators: [
    (Story) => (
      <div className="min-h-[30rem] bg-background p-5 text-muted-foreground">
        The start affordance the user pressed sits on this page.
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SessionConflictDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A quick-log draft, part-way through. */
export const PartwayThrough: Story = {}

/** An unnamed draft — the sheet still has to read sensibly. */
export const Unnamed: Story = {
  args: {
    session: { key: "new", name: null, setCount: 4, completedSetCount: 0 },
  },
}

/** Edit mode: the key is a workout uuid rather than 'new'. */
export const EditModeSession: Story = {
  args: {
    session: {
      key: "6f1c0a2e-0d3b-4a71-9d5e-2b8f0c4a91d7",
      name: "Upper A",
      setCount: 22,
      completedSetCount: 22,
    },
  },
}

/** Barely started — discarding costs almost nothing, and it should read that way. */
export const BarelyStarted: Story = {
  args: {
    session: { key: "new", name: "Leg day", setCount: 12, completedSetCount: 0 },
  },
}
