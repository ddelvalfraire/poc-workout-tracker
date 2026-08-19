import type { Meta, StoryObj } from "@storybook/nextjs-vite";

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
