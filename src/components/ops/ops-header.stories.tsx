import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { OpsHeader } from "./ops-header";

/**
 * The ops/product tab header. A **segmented control** — chips mean pressable
 * (DESIGN.md § Chips are controls) — and the active tab is the surface's one
 * volt moment.
 */
const meta = {
  title: "Ops/OpsHeader",
  component: OpsHeader,
  parameters: { layout: "padded" },
  argTypes: { active: { control: "inline-radio", options: ["ops", "product"] } },
  decorators: [
    (Story) => (
      <div className="w-[min(36rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OpsHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpsTab: Story = { args: { active: "ops" } }

export const ProductTab: Story = { args: { active: "product" } }

/**
 * Both states together — only one volt at a time.
 *
 * Each is scoped in its own <section>: OpsHeader renders a <header>, and two
 * of those at page level would be two `banner` landmarks. A <header> inside a
 * sectioning element is not a banner, so the comparison costs no a11y.
 */
export const BothStates: Story = {
  args: { active: "ops" },
  parameters: {
    a11y: {
      config: {
        // Rendering ONE component twice necessarily duplicates the <nav> it
        // owns. That is a property of this side-by-side harness, not of
        // OpsHeader — the shipped page mounts exactly one. Waived here only;
        // OpsTab and ProductTab still assert the rule individually.
        rules: [{ id: "landmark-unique", enabled: false }],
      },
    },
  },
  render: () => (
    <div className="flex flex-col gap-6">
      <section aria-label="Ops tab active">
        <OpsHeader active="ops" />
      </section>
      <section aria-label="Product tab active">
        <OpsHeader active="product" />
      </section>
    </div>
  ),
}

/**
 * Both tab branches must show keyboard focus (WCAG 2.4.7). The recipe gave
 * `focus-visible:border-primary` to the inactive branch only, so tabbing onto
 * the tab you are already on showed nothing — and the shared `outline-none`
 * had already cancelled the app-wide fallback. The volt ring is now the single
 * indicator on the unconditional half of the recipe, so this asserts it paints
 * for the active AND inactive tab rather than trusting the class string.
 */
export const KeyboardFocus: Story = {
  args: { active: "ops" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const activeTab = canvas.getByRole("link", { current: "page" });
    const inactiveTab = canvas.getByRole("link", { name: /product/i });

    // Unfocused, the active chip paints no ring…
    await expect(getComputedStyle(activeTab).boxShadow).toBe("none");

    // The back link comes first in the tab order; walk to the tab rather than
    // hard-coding how many stops that is.
    const doc = canvasElement.ownerDocument;
    for (let i = 0; i < 8 && doc.activeElement !== activeTab; i++) await userEvent.tab();
    await expect(activeTab).toHaveFocus();
    // …and keyboard focus paints the 3px volt ring (ring-3 ring-ring/50).
    await expect(getComputedStyle(activeTab).boxShadow).toContain("3px");

    await userEvent.tab();
    await expect(inactiveTab).toHaveFocus();
    await expect(getComputedStyle(inactiveTab).boxShadow).toContain("3px");
    await expect(getComputedStyle(activeTab).boxShadow).toBe("none");
  },
}
