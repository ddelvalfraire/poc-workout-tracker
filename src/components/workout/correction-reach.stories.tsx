import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { CorrectionReach } from "./correction-reach";

/**
 * GUARD 2 — how far a correction reaches, said at the edit surface.
 *
 * Information, so it never interrupts: no dialog, no gate, no second press.
 * It sits under the fields it is about, in one column, phrased positively.
 *
 * The two-column will/won't layout was rejected outright — negations parse
 * worst exactly when the reader is anxious about a number — so what STAYS is
 * carried below a hairline as a positive statement instead.
 *
 * Fixtures are pinned to a fixed instant, never Date.now(): "14 Aug" has to
 * mean the same pixels tomorrow.
 */
const AT = new Date("2026-08-14T09:00:00.000Z");

const meta = {
  title: "Components/CorrectionReach",
  component: CorrectionReach,
  parameters: { layout: "padded" },
  args: {
    exerciseName: "Bench Press",
    unit: "kg" as const,
    locale: "en" as const,
  },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CorrectionReach>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The case the whole guard exists for. Correcting the record-holding set
 * unseats a personal record — obvious and expected — while the training max
 * it fed does NOT move, which is the part nobody predicts and the part that
 * makes the app look wrong three weeks later. The settled line says so
 * positively, and says why.
 */
export const RecordMovesTrainingMaxStays: Story = {
  args: {
    reach: {
      items: [{ kind: "heaviestLoad", value: 100, performedAt: AT }],
      settled: { kind: "trainingMax", valueKg: 102.5, decidedAt: AT, sessionsSince: 3 },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Your heaviest Bench Press/i)).toBeInTheDocument();
    await expect(canvas.getByText(/training max stays at/i)).toBeInTheDocument();
    // Positive statements only — no "won't", no "can't", no second column.
    await expect(canvas.queryByText(/won.t|will not|can.t/i)).toBeNull();
  },
};

/**
 * Several records move at once — a correction to the session's top set can
 * unseat the e1RM, the load and the session tonnage together. Still one
 * column: the list grows, the shape does not.
 */
export const SeveralRecordsMove: Story = {
  args: {
    reach: {
      items: [
        { kind: "bestE1rm", value: 122.5, performedAt: AT },
        { kind: "heaviestLoad", value: 100, performedAt: AT },
        { kind: "bestSessionVolume", value: 2400, performedAt: AT },
      ],
      settled: { kind: "trainingMax", valueKg: 102.5, decidedAt: AT, sessionsSince: 3 },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole("listitem")).toHaveLength(3);
  },
};

/**
 * A record moves, but no settled decision rides on this exercise — an
 * accessory with no training max behind it. The list stands alone: no
 * hairline and no line below it, because inventing one would be filler.
 */
export const NoSettledDecision: Story = {
  args: {
    reach: {
      items: [{ kind: "mostReps", value: 8, performedAt: AT }],
      settled: null,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/most Bench Press reps/i)).toBeInTheDocument();
    await expect(canvas.queryByText(/training max/i)).toBeNull();
  },
};

/**
 * The ordinary typo fix: nothing moves, so nothing is shown. This story
 * renders an empty canvas on purpose — that blank IS the design, and it is
 * what keeps the disclosure worth reading on the day it does appear.
 */
export const OrdinaryTypoShowsNothing: Story = {
  args: { reach: null },
};
