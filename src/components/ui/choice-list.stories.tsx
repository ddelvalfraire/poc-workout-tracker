import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { Choice, ChoiceList } from "./choice-list";

/**
 * The single-choice list: hairline rows, each an option with the sentence that
 * makes it intelligible, and no boxed fieldset.
 *
 * It exists because the program form's choices are MODES — deload policy, diet
 * phase, stall response — small closed sets where each option needs explaining.
 * Collapsing three explained options into a `Select` makes the user open it,
 * read, close and remember. Left visible, the choice can simply be read.
 *
 * The whole row is the target: an 18px dot is far below the 44px touch floor,
 * and the row is what the eye reads as the button.
 */
const meta = {
  title: "UI/ChoiceList",
  component: ChoiceList,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChoiceList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The real case, verbatim from the program form. */
export const DeloadPolicy: Story = {
  args: { label: "Deload", children: null },
  render: () => (
    <ChoiceList label="Deload" defaultValue="scheduled">
      <Choice value="none" hint="Every week is a working week.">
        None
      </Choice>
      <Choice value="reactive" hint="Only when a lift stalls three sessions running.">
        Reactive
      </Choice>
      <Choice value="scheduled" hint="A planned lighter week, every block." trailing="Wk 6">
        Scheduled
      </Choice>
    </ChoiceList>
  ),
};

/** Short, self-evident options need no hints — the row just gets shorter. */
export const WithoutHints: Story = {
  args: { label: "Diet phase", children: null },
  render: () => (
    <ChoiceList label="Diet phase" defaultValue="maintenance">
      <Choice value="cut">Cut</Choice>
      <Choice value="maintenance">Maintenance</Choice>
      <Choice value="bulk">Bulk</Choice>
    </ChoiceList>
  ),
};

/** A disabled option still says why, which `<option disabled>` cannot. */
export const WithDisabledOption: Story = {
  args: { label: "Stall response", children: null },
  render: () => (
    <ChoiceList label="Stall response" defaultValue="hold">
      <Choice value="hold" hint="Keep the load and try again next week.">
        Hold
      </Choice>
      <Choice value="back-off" hint="Drop 10% and climb back.">
        Back off
      </Choice>
      <Choice value="deload" disabled hint="Needs a scheduled deload policy.">
        Deload the lift
      </Choice>
    </ChoiceList>
  ),
};

/**
 * Keyboard operation and the announced name — the two things the hand-rolled
 * fieldsets this replaces got wrong. The hint must be part of the accessible
 * name, or a screen reader announces "Reactive" and nothing else.
 */
export const KeyboardAndAnnouncement: Story = {
  args: { label: "Deload", children: null },
  render: () => (
    <ChoiceList label="Deload" defaultValue="none">
      <Choice value="none" hint="Every week is a working week.">
        None
      </Choice>
      <Choice value="reactive" hint="Only when a lift stalls three sessions running.">
        Reactive
      </Choice>
    </ChoiceList>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const [none, reactive] = canvas.getAllByRole("radio");

    await step("the caption NAMES the group, it is not just text above it", async () => {
      // axe does not flag an unnamed radiogroup, so this assertion is the only
      // thing standing between the caption and going back to a bare <div>.
      // Without it a user arrowing through hears "Reactive, radio, 2 of 3"
      // with no idea which of the four groups in the settings panel they are in.
      await expect(canvas.getByRole("radiogroup")).toHaveAccessibleName("Deload");
    });

    await step("the hint is part of the announced name, not orphaned beside it", async () => {
      await expect(reactive).toHaveAccessibleName(/stalls three sessions/i);
    });

    await step("the group starts on its default", async () => {
      await expect(none).toBeChecked();
    });

    await step("arrow keys move the selection", async () => {
      none.focus();
      await userEvent.keyboard("{ArrowDown}");
      await expect(reactive).toBeChecked();
      await expect(none).not.toBeChecked();
    });
  },
};
