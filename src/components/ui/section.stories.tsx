import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DividerList, DividerRow } from "./divider-list";
import { EmptyWords } from "./empty-words";
import { Section } from "./section";

/**
 * A de-carded page section (DESIGN.md § De-card vocabulary).
 *
 * A condensed-caps header sits OVER its content — no shell, no background.
 * The content carries its own hairlines. This is the settings-zone shape, and
 * it is the default for every list/detail surface in the app.
 */
const meta = {
  title: "UI/Section",
  component: Section,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Section>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Training",
    children: (
      <DividerList>
        <DividerRow href="#" trailing="3 active">
          Programs
        </DividerRow>
        <DividerRow href="#" trailing="kg">
          Units
        </DividerRow>
        <DividerRow href="#">Rest timer</DividerRow>
      </DividerList>
    ),
  },
}

/** Headerless — a section can be a bare group when the page title carries it. */
export const Headerless: Story = {
  args: {
    children: (
      <DividerList>
        <DividerRow href="#">Export data</DividerRow>
        <DividerRow href="#">Sign out</DividerRow>
      </DividerList>
    ),
  },
}

/** An empty section states the fact plainly — never a boxed apology. */
export const Empty: Story = {
  args: {
    title: "History",
    children: <EmptyWords>No sessions logged yet.</EmptyWords>,
  },
}

/** Stacked zones — the shipped /settings page shape. */
export const StackedZones: Story = {
  args: { children: null },
  render: () => (
    <div>
      <Section title="Training">
        <DividerList>
          <DividerRow href="#" trailing="3 active">
            Programs
          </DividerRow>
          <DividerRow href="#" trailing="kg">
            Units
          </DividerRow>
        </DividerList>
      </Section>
      <Section title="Account">
        <DividerList>
          <DividerRow href="#" trailing="you@example.com">
            Email
          </DividerRow>
          <DividerRow href="#">Notifications</DividerRow>
        </DividerList>
      </Section>
      <Section title="Danger zone">
        <DividerList dashed>
          <DividerRow href="#">Delete account</DividerRow>
        </DividerList>
      </Section>
    </div>
  ),
}
