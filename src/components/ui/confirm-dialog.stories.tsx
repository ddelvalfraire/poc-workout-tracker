import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { ConfirmDialog } from "./confirm-dialog";

/**
 * The centered destructive-confirm modal — a TRUE modal, and a **keep-list**
 * surface (elevation is the point of an overlay).
 *
 * Built on native `<dialog>` + `showModal()`, so the *browser* owns the focus
 * trap and makes the page behind genuinely inert. A screen reader's virtual
 * cursor cannot walk behind it, which a hand-rolled Tab trap never guarantees.
 *
 * The contract worth knowing before you use it: the dialog stays OPEN while
 * `onConfirm` runs, so a failure can surface `error` in place and the user
 * retries without losing context. On a success path that ends in navigation
 * the parent MUST call `closeRef.current?.()` before `router.push` — relying
 * on unmount cleanup races React's flush and can strand the `::backdrop` over
 * the destination page, eating every tap.
 */
const meta = {
  title: "Components/ConfirmDialog",
  component: ConfirmDialog,
  parameters: { layout: "fullscreen" },
  args: {
    title: "Delete program?",
    body: "Push / Pull / Legs and its 12 logged sessions stay, but the program is removed.",
    confirmLabel: "Delete",
    pendingLabel: "Deleting…",
    isPending: false,
    error: null,
    onConfirm: fn(),
    onClose: fn(),
  },
  decorators: [
    (Story) => (
      <div className="min-h-[26rem] bg-background p-5 text-muted-foreground">
        The page behind the modal — inert while it is open.
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Destructive: Story = {}

/** In-flight: the pending label shows and the dialog stays open. */
export const Pending: Story = { args: { isPending: true } }

/** A failure surfaces in place — the user retries without losing context. */
export const WithError: Story = {
  args: { error: "Couldn't delete — you're offline." },
}

/**
 * Affirmative confirms use the volt `default` variant. Destructive stays the
 * default so existing callers are untouched.
 */
export const Affirmative: Story = {
  args: {
    title: "Restart this block?",
    body: "Week 1 becomes the current week. Logged sessions are kept.",
    confirmLabel: "Restart block",
    pendingLabel: "Restarting…",
    confirmVariant: "default",
  },
}

/** Long body copy still leaves both actions reachable. */
export const LongBody: Story = {
  args: {
    title: "Delete account?",
    body: "This removes every workout, program, goal, body measurement and photo you have logged. Exported data is not affected. This cannot be undone.",
    confirmLabel: "Delete everything",
    pendingLabel: "Deleting…",
  },
}
