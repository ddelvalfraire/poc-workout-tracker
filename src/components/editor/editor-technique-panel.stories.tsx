import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { EditorTechniquePanel } from "./editor-technique-panel";
import type { DerivedSet } from "@/lib/progression";

/**
 * The draft boundary. The form beside this one has no opinion about saving;
 * this component owns the draft and posts it once.
 *
 * What these stories really check is that unsaved work LOOKS unsaved. A stack
 * that quietly wrote on every keystroke would put half-built techniques into
 * the change log and in front of anyone reading the plan, so "dirty" has to be
 * a state the surface admits to.
 */
const topSet: DerivedSet = {
  setNumber: 3,
  setType: "working",
  metricMode: "reps_weight",
  repMin: 15,
  repMax: 15,
  rir: null,
  rpe: null,
  loadKg: 25,
  tempo: null,
  durationSec: null,
  distanceM: null,
  restSec: 180,
  technique: null,
  derivedFrom: "template",
  sourceIndex: 0,
};

const meta = {
  title: "Editor/EditorTechniquePanel",
  component: EditorTechniquePanel,
  parameters: { layout: "padded" },
  args: {
    programId: "0f1c8a2e-4d3b-4a55-9f77-0a1b2c3d4e5f",
    day: 0,
    exercise: 1,
    setNumber: 3,
    topSet,
    unit: "kg",
    scope: "Cable Face Pull · set 3 of 3",
    action: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EditorTechniquePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing staged: Save reads as done, and there is nothing to discard. */
export const Clean: Story = {
  args: { saved: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByRole("button", { name: "Saved" })).toBeDisabled();
    await expect(canvas.queryByRole("button", { name: "Discard" })).toBeNull();
  },
};

/**
 * Choosing a kind stages a change: the button changes word, Discard appears,
 * and nothing has been written — the whole point of the draft boundary.
 */
export const StagedEdit: Story = {
  args: { saved: null },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByRole("button", { name: /Drop set/ }));

    await expect(await canvas.findByRole("button", { name: "Save technique" })).toBeEnabled();
    await expect(await canvas.findByRole("button", { name: "Discard" })).toBeVisible();
    expect(args.action).not.toHaveBeenCalled();
  },
};

/** Discard returns to the saved stack rather than to empty. */
export const DiscardRestoresSaved: Story = {
  args: {
    saved: { version: 1, kind: "myo-reps", stages: [{ reps: 5, restSec: 15 }] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByRole("button", { name: /Straight set/ }));
    await expect(await canvas.findByRole("button", { name: "Save technique" })).toBeEnabled();

    await userEvent.click(await canvas.findByRole("button", { name: "Discard" }));

    // Back to the stored stack, and back to clean.
    await expect(await canvas.findByRole("button", { name: "Saved" })).toBeDisabled();
    await expect(await canvas.findByText("Stage 1")).toBeVisible();
  },
};

/**
 * Editing back to exactly what is stored is not a change. Dirtiness is measured
 * against the saved value, not against "has the user touched anything".
 */
export const ReturningToSavedIsClean: Story = {
  args: {
    saved: { version: 1, kind: "drop-set", stages: [{ reps: 6, loadKg: 20 }] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByRole("button", { name: /Rest-pause/ }));
    await expect(await canvas.findByRole("button", { name: "Save technique" })).toBeEnabled();

    await userEvent.click(await canvas.findByRole("button", { name: /Drop set/ }));

    await expect(await canvas.findByRole("button", { name: "Saved" })).toBeDisabled();
  },
};

/** The write's scope is stated on the surface, before it happens. */
export const StatesItsScope: Story = {
  args: { saved: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByText(/changes this set's plan, not just this week/),
    ).toBeVisible();
  },
};

/**
 * The case the kind-toggle story above did NOT cover, and the one that was
 * broken: cycling a stage's load mode kg → % → kg restores the same numbers,
 * but rebuilds the stage object, so a key-order-sensitive comparison called it
 * dirty. Saving that would have written an empty edit to the change log.
 */
export const LoadModeRoundTripIsClean: Story = {
  args: {
    saved: { version: 1, kind: "drop-set", stages: [{ loadKg: 20, reps: 6 }] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const mode = await canvas.findByRole("button", { name: /Load unit/ });

    await userEvent.click(mode); // kg -> %
    await expect(await canvas.findByRole("button", { name: "Save technique" })).toBeEnabled();

    await userEvent.click(await canvas.findByRole("button", { name: /Load unit/ })); // % -> rack
    await userEvent.click(await canvas.findByRole("button", { name: /Load unit/ })); // rack -> kg
    await userEvent.type(await canvas.findByLabelText(/Stage 1 · Load$/), "20");

    await expect(await canvas.findByRole("button", { name: "Saved" })).toBeDisabled();
  },
};
