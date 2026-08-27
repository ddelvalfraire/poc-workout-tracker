import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { SummaryRow } from "./summary-row";

/**
 * One hairline row standing in for a whole settings group — the program's
 * length, deload and auto-regulation state as a sentence you can check at a
 * glance, opening to the controls behind it.
 *
 * The summary is WORDS in the muted ink, never chips: chip styling means "you
 * can press me", and these are labels reporting where things stand. The one
 * pressable thing is the row itself.
 */
const meta = {
  title: "ProgramForm/SummaryRow",
  component: SummaryRow,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SummaryRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const settings = (
  <p className="pt-2 text-sm text-muted-foreground">
    Length, deload policy, diet phase and auto-regulation live here.
  </p>
);

/** Closed — the default. The defaults are sane, so this is a line to check. */
export const Closed: Story = {
  args: {
    label: "Program settings",
    summary: "6 wk · deload wk 6 · autoreg off",
    children: settings,
  },
};

/** Open. */
export const Open: Story = {
  args: {
    label: "Program settings",
    summary: "6 wk · deload wk 5 · autoreg on",
    defaultOpen: true,
    children: settings,
  },
};

/** A long summary truncates instead of pushing the chevron off the row. */
export const LongSummary: Story = {
  args: {
    label: "Program settings",
    summary: "12 wk · deload wk 6 · autoreg on · cutting · check-in every 7 days",
    children: settings,
  },
};

/** The row toggles, and reports its state to assistive tech. */
export const Toggles: Story = {
  args: {
    label: "Program settings",
    summary: "6 wk · deload wk 6 · autoreg off",
    children: settings,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("button", { name: /Program settings/ });
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(row);
    await expect(row).toHaveAttribute("aria-expanded", "true");
  },
};
