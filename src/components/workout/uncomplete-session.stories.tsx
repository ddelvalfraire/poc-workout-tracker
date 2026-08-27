import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { UncompleteSession } from "./uncomplete-session";

/**
 * GUARD 1 — the un-complete decision, and the cascade it drags with it.
 *
 * A decision interrupts; information does not. This one interrupts, and only
 * when there is something to interrupt FOR: the press asks the server what
 * would move, and a session whose un-complete moves nothing goes straight
 * through with no dialog at all.
 *
 * The catalog is the verification surface here — the app needs a database and
 * a WorkOS session to boot — so `previewOverride` stands in for the dry run
 * and every branch is reachable as a story.
 */
const meta = {
  title: "Components/UncompleteSession",
  component: UncompleteSession,
  parameters: { layout: "padded" },
  args: { workoutId: "storybook-workout" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))] space-y-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UncompleteSession>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The block sits on week 4 only because this session finished. Un-completing
 * it rolls the week back, so the decision is interrupted — and the dialog
 * names the CASCADE, never the un-complete the user just asked for. Two
 * lines, both derived from the one dry-run fact; buttons that name outcomes;
 * no type-to-confirm anywhere.
 */
export const CascadeInterrupts: Story = {
  args: { previewOverride: { weekRollback: { from: 4, to: 3 }, blockReopens: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /mark not finished/i }));
    const dialog = await waitFor(() => within(document.body).getByRole("dialog"));
    const inDialog = within(dialog);
    await expect(inDialog.getByText(/goes back to week 3/i)).toBeInTheDocument();
    await expect(inDialog.getByText(/targets are worked out again/i)).toBeInTheDocument();
    await expect(inDialog.getByRole("button", { name: /keep it completed/i })).toBeInTheDocument();
    await expect(inDialog.getByRole("button", { name: /^un-complete$/i })).toBeInTheDocument();
    await expect(inDialog.queryByRole("textbox")).toBeNull();
  },
};

/**
 * The block reads finished today and would stop reading finished. A different
 * fact from the week rollback, so it is a different line — and it stands
 * alone when the week itself does not move.
 */
export const BlockReopens: Story = {
  args: { previewOverride: { weekRollback: null, blockReopens: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /mark not finished/i }));
    const dialog = await waitFor(() => within(document.body).getByRole("dialog"));
    await expect(within(dialog).getByText(/stops counting as finished/i)).toBeInTheDocument();
    await expect(within(dialog).queryByText(/goes back to week/i)).toBeNull();
  },
};

/**
 * Nothing moves — an ordinary session mid-week, or one with no program behind
 * it at all. NO DIALOG: it un-completes on the press, and the undo strip is
 * what stands behind it. A modal that fires every time is a modal nobody
 * reads.
 */
export const NoCascadeNoDialog: Story = {
  args: { previewOverride: { weekRollback: null, blockReopens: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /mark not finished/i }));
    await waitFor(async () =>
      expect(canvas.getByText(/session marked not finished/i)).toBeInTheDocument(),
    );
    await expect(within(document.body).queryByRole("dialog")).toBeNull();
    await expect(canvas.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  },
};

/**
 * The undo, after the dialog. The modal handles the moment; this handles the
 * year, once the dialog has become furniture and gets clicked through. It
 * names what happened — including the week the block fell back to — and the
 * drain hairline IS the window's clock.
 */
export const UndoAfterTheCascade: Story = {
  args: { previewOverride: { weekRollback: { from: 4, to: 3 }, blockReopens: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /mark not finished/i }));
    const dialog = await waitFor(() => within(document.body).getByRole("dialog"));
    await userEvent.click(within(dialog).getByRole("button", { name: /^un-complete$/i }));
    await waitFor(async () =>
      expect(canvas.getByText(/block back to week 3/i)).toBeInTheDocument(),
    );
    await expect(canvas.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  },
};
