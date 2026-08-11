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

/** Both states together — only one volt at a time. */
export const BothStates: Story = {
  args: { active: "ops" },
  render: () => (
    <div className="flex flex-col gap-6">
      <OpsHeader active="ops" />
      <OpsHeader active="product" />
    </div>
  ),
}
