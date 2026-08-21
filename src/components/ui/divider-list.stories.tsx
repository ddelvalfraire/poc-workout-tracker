import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { DividerList, DividerRow } from "./divider-list";

/**
 * The grouped divider list — the iOS-grouped-list shape in the de-card
 * vocabulary (DESIGN.md). Rows are separated by muted hairlines and the group
 * CLOSES with one, instead of being wrapped in a rounded shell.
 *
 * The whole row is the control: content left, optional trailing value and
 * chevron right.
 */
const meta = {
  title: "UI/DividerList",
  component: DividerList,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DividerList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <>
        <DividerRow href="#">Push / Pull / Legs</DividerRow>
        <DividerRow href="#">Upper / Lower</DividerRow>
        <DividerRow href="#">Full body</DividerRow>
      </>
    ),
  },
}

/** Trailing values sit in muted ink before the chevron — words, not chips. */
export const WithTrailingValues: Story = {
  args: {
    children: (
      <>
        <DividerRow href="#" trailing="kg">
          Weight unit
        </DividerRow>
        <DividerRow href="#" trailing="90s">
          Default rest
        </DividerRow>
        <DividerRow href="#" trailing="Sun">
          Week starts
        </DividerRow>
      </>
    ),
  },
}

/**
 * The dashed variant is the quarantined / pending voice — "present, but not
 * product". Reach for it deliberately, not for visual variety.
 */
export const Dashed: Story = {
  args: {
    dashed: true,
    children: (
      <>
        <DividerRow href="#">Archived program</DividerRow>
        <DividerRow href="#">Draft template</DividerRow>
      </>
    ),
  },
}

/** Two-line rows: title plus muted metadata under it. */
export const TwoLineRows: Story = {
  args: {
    children: (
      <>
        <DividerRow href="#" trailing="12 sets">
          <div className="min-w-0">
            <div className="truncate">Bench press</div>
            <div className="truncate text-sm text-muted-foreground">
              Last: 82.5 kg × 5
            </div>
          </div>
        </DividerRow>
        <DividerRow href="#" trailing="9 sets">
          <div className="min-w-0">
            <div className="truncate">Barbell row</div>
            <div className="truncate text-sm text-muted-foreground">
              Last: 70 kg × 8
            </div>
          </div>
        </DividerRow>
      </>
    ),
  },
}

/** A single row still closes with its hairline — the group shape is intact. */
export const SingleRow: Story = {
  args: { children: <DividerRow href="#">Only item</DividerRow> },
}

/** Long labels truncate rather than pushing the trailing cluster off-screen. */
export const LongLabel: Story = {
  args: {
    children: (
      <DividerRow href="#" trailing="3">
        <span className="truncate">
          Romanian deadlift with a deficit and a three second eccentric
        </span>
      </DividerRow>
    ),
  },
}

/**
 * Keyboard focus must actually be visible (WCAG 2.4.7). The first recipe
 * paired `outline-none` with a `focus-visible:bg-muted/50` wash — ~1.1:1
 * against the page background, so tabbing through a list showed nothing at
 * all. The row now takes the app-wide volt ring, and this story proves it in
 * a real browser: tab onto the row and assert the ring PAINTS (a computed
 * box-shadow), not merely that a class is present.
 */
export const KeyboardFocus: Story = {
  args: {
    children: (
      <DividerRow href="#" trailing="kg">
        Weight unit
      </DividerRow>
    ),
  },
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByRole("link", { name: /weight unit/i });
    // Unfocused, the row paints no ring…
    await expect(getComputedStyle(row).boxShadow).toBe("none");
    await userEvent.tab();
    await expect(row).toHaveFocus();
    // …and keyboard focus paints the 3px volt ring (ring-3 ring-ring/50).
    const shadow = getComputedStyle(row).boxShadow;
    await expect(shadow).not.toBe("none");
    await expect(shadow).toContain("3px");
  },
}
