import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { SwitchRow } from "./switch-row";

/**
 * The labelled on/off row — the boolean sibling of `Choice`, shaped to match it
 * so a settings column reads as one list whether a setting is a mode or a
 * switch.
 *
 * The track is the app's existing switch, extracted rather than reinvented:
 * eight files under `src/app/settings/` hand-roll the same `role="switch"`
 * button with a 28×48 track and an invisible `before:-inset-2` restoring the
 * 44px target. This is presentation only — those copies own their optimistic
 * write paths and can adopt the track without giving them up.
 */
const meta = {
  title: "UI/SwitchRow",
  component: SwitchRow,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SwitchRow>;

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ initial = false, hint }: { initial?: boolean; hint?: string }) {
  const [on, setOn] = useState(initial);
  return (
    <SwitchRow checked={on} onCheckedChange={setOn} hint={hint}>
      Auto-regulate loads
    </SwitchRow>
  );
}

/** The real case: a setting whose name explains nothing without its sentence. */
export const WithHint: Story = {
  args: { checked: false, onCheckedChange: () => {}, children: null },
  render: () => <Controlled hint="After missed reps, sessions say what to do next — and why." />,
};

export const On: Story = {
  args: { checked: true, onCheckedChange: () => {}, children: null },
  render: () => <Controlled initial hint="Sessions adopt loads you actually hit." />,
};

/** No hint — the row collapses to a single line. */
export const Bare: Story = {
  args: { checked: false, onCheckedChange: () => {}, children: null },
  render: () => <Controlled />,
};

export const Disabled: Story = {
  args: { checked: false, onCheckedChange: () => {}, children: null },
  render: () => (
    <SwitchRow checked={false} onCheckedChange={() => {}} disabled hint="Needs auto-regulation on.">
      Stall response
    </SwitchRow>
  ),
};

/**
 * The name/description split. Unlike `Choice`, where the hint distinguishes one
 * option from another and so belongs in the NAME, a switch has one name and two
 * states — folding the sentence in would replay the explanation on every flip.
 */
export const NameAndDescription: Story = {
  args: { checked: false, onCheckedChange: () => {}, children: null },
  render: () => <Controlled hint="After missed reps, sessions say what to do next — and why." />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole("switch");

    await step("the name is the label alone, not the sentence", async () => {
      await expect(control).toHaveAccessibleName("Auto-regulate loads");
      await expect(control).toHaveAccessibleDescription(/after missed reps/i);
    });

    await step("starts off and reports its state", async () => {
      await expect(control).not.toBeChecked();
    });

    await step("flips on click", async () => {
      await userEvent.click(control);
      await expect(control).toBeChecked();
    });

    await step("flips from the keyboard", async () => {
      await userEvent.keyboard("{ }");
      await expect(control).not.toBeChecked();
    });
  },
};
