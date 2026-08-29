import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { UnitToggle } from "./unit-toggle";

/**
 * The segmented kg | lb toggle from the home header.
 *
 * A **control cluster** — chips mean pressable (DESIGN.md § Chips are
 * controls). The active unit is the volt; the inactive one is ghost. Selecting
 * the active unit is a no-op.
 *
 * The unit is never optimistically changed: it persists via a server action,
 * then `router.refresh()` re-runs the server components so every weight in the
 * app re-renders in the new unit. On failure it surfaces visible words —
 * "Didn't save — tap again" — rather than a bare "!" with a title tooltip,
 * which is unreachable on touch and meaningless to a screen reader.
 *
 * In Storybook the server action is stubbed (`.storybook/mocks/app-actions.ts`)
 * with ~600ms of latency, so the disabled/pending state is actually visible
 * when you press.
 */
const meta = {
  title: "Components/UnitToggle",
  component: UnitToggle,
  args: { unit: "kg" },
  argTypes: { unit: { control: "inline-radio", options: ["kg", "lb"] } },
} satisfies Meta<typeof UnitToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Kilograms: Story = {}

export const Pounds: Story = { args: { unit: "lb" } }

/** As it sits in the home header, beside the page title. */
export const InHeader: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="flex w-[min(28rem,calc(100vw-2rem))] items-center justify-between gap-4">
      <h1 className="text-xl uppercase tracking-tight">Today</h1>
      <UnitToggle {...args} />
    </div>
  ),
}
