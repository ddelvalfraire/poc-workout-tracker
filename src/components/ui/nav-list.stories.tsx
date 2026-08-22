import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { DividerList, DividerRow } from "./divider-list";
import { NavList, NavRow } from "./nav-list";
import { Section } from "./section";

/**
 * The sub-destination cluster: the rows that LEAVE a detail screen, as
 * opposed to the rows that are the screen.
 *
 * It renders the same hairlines as `DividerList` on purpose — the difference
 * is what it refuses to render. `NavRow` has no `trailing` slot and no icon
 * slot, so a nav row is structurally incapable of carrying a count, a delta,
 * or a value. On a page that already stacks several divider lists, that
 * emptiness is the only differentiator left once card shells are off the
 * table: content rows are dense, so navigation rows must be bare.
 *
 * Headerless by design. See the NavVsContent story for the comparison the
 * component exists to win.
 */
const meta = {
  title: "UI/NavList",
  component: NavList,
  parameters: { layout: "padded" },
  args: { label: "Program" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NavList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shipped case: three destinations off the active-program screen. */
export const Default: Story = {
  args: {
    children: (
      <>
        <NavRow href="#">Coach</NavRow>
        <NavRow href="#">Program stats</NavRow>
        <NavRow href="#">About this program</NavRow>
      </>
    ),
  },
}

/**
 * The comparison that motivates the component. Above: content rows, dense
 * with numerals under a condensed-caps header. Below: the nav cluster, bare
 * and headerless after a visibly larger gap.
 *
 * Nothing here is a new colour, radius or shell — the separation is carried
 * entirely by density, the missing header, and proximity. If a future change
 * puts a value back into a nav row, this story is where it will look wrong.
 */
export const NavVsContent: Story = {
  args: {
    children: (
      <>
        <NavRow href="#">Coach</NavRow>
        <NavRow href="#">Program stats</NavRow>
        <NavRow href="#">About this program</NavRow>
      </>
    ),
  },
  render: (args) => (
    <div>
      <Section title="Auto-regulation">
        <DividerList className="mt-2">
          <DividerRow href="#" trailing="120 kg">
            <span className="text-sm font-medium">Back Squat</span>
          </DividerRow>
          <DividerRow href="#" trailing="92.5 kg">
            <span className="text-sm font-medium">Bench Press</span>
          </DividerRow>
        </DividerList>
      </Section>
      <NavList {...args} />
    </div>
  ),
}

/**
 * A single destination still closes with its hairlines. Below two rows the
 * cluster reads as an afterthought — a signal the group may not be earning
 * its place — but the shape stays intact.
 */
export const SingleDestination: Story = {
  args: { children: <NavRow href="#">About this program</NavRow> },
}

/**
 * Long names truncate rather than wrapping — a wrapped destination pushes the
 * chevron off its baseline and makes a two-row cluster look like four.
 */
export const LongLabel: Story = {
  args: {
    children: (
      <>
        <NavRow href="#">
          <span className="truncate">
            About this program and how the author intends you to run it
          </span>
        </NavRow>
        <NavRow href="#">Coach</NavRow>
      </>
    ),
  },
}

/**
 * The landmark carries a name. An unnamed `<nav>` is indistinguishable from
 * every other landmark in a screen reader's rotor, which is why `label` is
 * required rather than optional — assistive tech gets the grouping a sighted
 * reader gets from the gap above the cluster.
 */
export const NamedLandmark: Story = {
  args: {
    children: (
      <>
        <NavRow href="#">Coach</NavRow>
        <NavRow href="#">Program stats</NavRow>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole("navigation", { name: "Program" });
    await expect(nav).toBeInTheDocument();
  },
}

/**
 * Keyboard focus paints the app-wide volt ring, same as every other row in
 * the system. Asserted as a COMPUTED box-shadow rather than a class name — a
 * focus style present in the markup but painting nothing is exactly the WCAG
 * 2.4.7 failure this recipe exists to avoid.
 */
export const KeyboardFocus: Story = {
  args: { children: <NavRow href="#">Program stats</NavRow> },
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByRole("link", { name: /program stats/i });
    await expect(getComputedStyle(row).boxShadow).toBe("none");
    await userEvent.tab();
    await expect(row).toHaveFocus();
    const shadow = getComputedStyle(row).boxShadow;
    await expect(shadow).not.toBe("none");
    await expect(shadow).toContain("3px");
  },
}
