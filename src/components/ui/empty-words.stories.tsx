import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { EmptyWords } from "./empty-words";
import { Section } from "./section";

/**
 * An empty state as plain words (DESIGN.md § De-card vocabulary): a centered
 * muted sentence. No shell, no illustration, no boxed apology.
 *
 * Write the sentence like a person: say what is not there, and — when there
 * is one — what to do about it.
 */
const meta = {
  title: "UI/EmptyWords",
  component: EmptyWords,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EmptyWords>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "No sessions logged yet." },
}

export const WithNextStep: Story = {
  args: { children: "No programs yet — start one to see it here." },
}

/** Filtered-to-nothing reads differently from never-had-anything. */
export const NoResults: Story = {
  args: { children: "Nothing matches “deadlif”." },
}

/** In place inside a section, where it actually appears. */
export const InSection: Story = {
  args: { children: "No sets logged this week." },
  render: () => (
    <Section title="This week">
      <EmptyWords>No sets logged this week.</EmptyWords>
    </Section>
  ),
}
