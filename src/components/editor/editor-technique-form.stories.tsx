import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";

import { EditorTechniqueForm } from "./editor-technique-form";
import type { Technique } from "@/lib/programs/program-input";
import type { DerivedSet } from "@/lib/programs/progression";

/**
 * The technique stack. Read the preview, not the fields: "The set becomes"
 * calls the REAL `expandTechniqueStages`, so these stories double as a check
 * that the authoring surface and the logger agree about how many rows a stack
 * produces and what each one weighs.
 *
 * The case worth staring at is Percentage: 115 × 0.8 is 92, which is not a
 * weight anyone can load, so the preview shows 92.5. An author doing that
 * arithmetic in their head gets a different number than the gym does — which is
 * exactly why the preview runs the engine instead of restating the input.
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

/** Controlled in the story, as it is in the app — the parent owns the value. */
function Harness({
  initial,
  top,
  unit = "kg",
}: {
  initial: Technique | null;
  top?: DerivedSet;
  unit?: "kg" | "lb";
}) {
  const [value, setValue] = useState<Technique | null>(initial);
  return (
    <EditorTechniqueForm
      value={value}
      onChange={setValue}
      topSet={top ?? topSet}
      unit={unit}
      setNumber={3}
      scope="Cable Face Pull · set 3 of 3"
    />
  );
}

const meta = {
  title: "Editor/EditorTechniqueForm",
  component: Harness,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No technique: the stack and preview are absent, not empty-stated. */
export const StraightSet: Story = {
  args: { initial: null },
};

/** Myo-reps, the mock's case: activation set plus four mini-sets. */
export const MyoReps: Story = {
  args: {
    initial: {
      version: 1,
      kind: "myo-reps",
      stages: [
        { reps: 5, restSec: 15 },
        { reps: 5, restSec: 15 },
        { reps: 5, restSec: 15 },
        { reps: 5, restSec: 15 },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Five rows in the logger: the top set plus four mini-sets.
    await expect(await canvas.findByText("3d")).toBeVisible();
    // Volume is weighted, not counted: 1 + 0.5 × 4.
    await expect(await canvas.findByText(/3 sets for volume/)).toBeVisible();
  },
};

/**
 * A percentage stage against a progressed top set. 115 × 0.8 = 92, which is off
 * the 1.25 kg grid, so the prescription is 92.5.
 */
export const Percentage: Story = {
  args: {
    initial: { version: 1, kind: "drop-set", stages: [{ reps: 6, loadPct: 0.8 }] },
    top: { ...topSet, loadKg: 115 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("6 @ 92.5 kg")).toBeVisible();
  },
};

/** A stage with no load at all — the third state, labelled rather than blank. */
export const TypedAtTheRack: Story = {
  args: { initial: { version: 1, kind: "drop-set", stages: [{ reps: 8 }] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The mode control IS the label in this state — one control, one string.
    await expect(await canvas.findByRole("button", { name: /Load/ })).toHaveTextContent(
      "Typed at the rack",
    );
    await expect(await canvas.findByText(/weight typed at the rack/)).toBeVisible();
  },
};

/** A cluster counts 1.0 whole however many blocks — the volume exception. */
export const Cluster: Story = {
  args: {
    initial: {
      version: 1,
      kind: "cluster",
      stages: [
        { reps: 3, restSec: 20 },
        { reps: 3, restSec: 20 },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/1 sets for volume/)).toBeVisible();
  },
};

/**
 * The mode control cycles kg → % → typed at the rack, converting where it can:
 * 20 kg off a 25 kg top set is 80%.
 */
export const SwitchingLoadMode: Story = {
  args: { initial: { version: 1, kind: "drop-set", stages: [{ reps: 6, loadKg: 20 }] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const modeButtons = await canvas.findAllByRole("button", { name: /Load/ });

    await userEvent.click(modeButtons[0]);

    await expect(await canvas.findByDisplayValue("80")).toBeVisible();
  },
};

/**
 * A percentage of a load-less top set resolves to nothing, never to zero — and
 * so does the top set itself, so BOTH preview rows read as typed at the rack.
 */
export const PercentageOfNoLoad: Story = {
  args: {
    initial: { version: 1, kind: "drop-set", stages: [{ reps: 6, loadPct: 0.8 }] },
    top: { ...topSet, loadKg: null },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = await canvas.findAllByText(/weight typed at the rack/);

    expect(rows).toHaveLength(2);
  },
};

/**
 * The same stack for a pounds account — the default unit, so this is the
 * common case rather than the exotic one.
 *
 * Loads are STORED in kilograms (`loadKg` is kg by name and by schema) and
 * converted only for display, so a 100 kg top set reads 220.5 lb. Before this
 * story existed the component rendered the kilogram numbers under an lb label.
 *
 * The drop is 177.5 lb, not the 176.4 a raw conversion of 80 kg gives: the
 * resolution quantizes to the grid of the unit being READ, so a pounds lifter
 * gets a weight they can actually put on the bar.
 */
export const PoundsAccount: Story = {
  args: {
    initial: { version: 1, kind: "drop-set", stages: [{ reps: 6, loadPct: 0.8 }] },
    top: { ...topSet, loadKg: 100 },
    unit: "lb",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText("15 @ 220.5 lb")).toBeVisible();
    await expect(await canvas.findByText("6 @ 177.5 lb")).toBeVisible();
  },
};
