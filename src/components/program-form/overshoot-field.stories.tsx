import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";

import { OvershootField } from "./overshoot-field";
import type { OvershootPolicy } from "@/lib/programs/overshoot-policy";

/**
 * "What counts as beating the target" — a row that opens a sheet.
 *
 * The control this replaces was a native `<select>` offering four words:
 * default / strict / e1RM-equivalent / any metric. Nobody can choose between
 * four pieces of jargon, so in practice nobody did. Four labels in a dropdown
 * is not a decision surface.
 *
 * Open the sheet in any story below: every option states what it DOES, and
 * where the caller can supply one, the sheet closes with the rule applied to
 * that movement's actual prescription. That last part is the whole point — a
 * setting whose effect you can only learn by training under it for three
 * weeks has not really been offered to you.
 */
const meta = {
  title: "Components/OvershootField",
  component: OvershootField,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OvershootField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A stateful wrapper — the row shows the current choice, so a static arg
 *  would freeze every story the moment you picked something. */
function Interactive(args: React.ComponentProps<typeof OvershootField>) {
  const [value, setValue] = useState<OvershootPolicy | null>(args.value);
  return <OvershootField {...args} value={value} onChange={setValue} />;
}

/**
 * The shipped exercise case. `null` leads and is a real choice, not an
 * absence: it defers to the program policy, then to the scheme's default —
 * and it NAMES what that resolves to, because "default" on its own just moves
 * the question one level down.
 */
export const Exercise: Story = {
  args: {
    value: null,
    onChange: () => {},
    exerciseName: "Back Squat",
    resolvesTo: "strict-load",
    preview: { reps: "5", load: "120 kg" },
  },
  render: (args) => <Interactive {...args} />,
}

/**
 * The program-level default an exercise may override. No exercise name and no
 * preview: there is no single prescription to apply the rule to, so the sheet
 * shows options only rather than inventing an example.
 *
 * This row went missing when the old detail-page control was deleted, leaving
 * program-level policy settable only through MCP.
 */
export const ProgramDefault: Story = {
  args: {
    value: "e1rm-equivalent",
    onChange: () => {},
    resolvesTo: "strict-load",
  },
  render: (args) => <Interactive {...args} />,
}

/** An explicit override reads back on the row, not just inside the sheet. */
export const Overridden: Story = {
  args: {
    value: "any-metric",
    onChange: () => {},
    exerciseName: "Weighted Pull-Up",
    resolvesTo: "e1rm-equivalent",
    preview: { reps: "6", load: "+10 kg" },
  },
  render: (args) => <Interactive {...args} />,
}

/** A rep RANGE survives the preview line — the common accessory shape. */
export const RepRange: Story = {
  args: {
    value: "e1rm-equivalent",
    onChange: () => {},
    exerciseName: "Cable Face Pull",
    resolvesTo: "e1rm-equivalent",
    preview: { reps: "12–15", load: "25 kg" },
  },
  render: (args) => <Interactive {...args} />,
}

/**
 * A long movement name must not push the current value off the row — the name
 * truncates, the value and chevron hold their place.
 */
export const LongExerciseName: Story = {
  args: {
    value: "strict-load",
    onChange: () => {},
    exerciseName: "Single-Arm Half-Kneeling Landmine Press",
    resolvesTo: "strict-load",
    preview: { reps: "10", load: "22.5 kg" },
  },
  render: (args) => <Interactive {...args} />,
}

/**
 * The behaviour the component exists for: opening the sheet shows a
 * CONSEQUENCE beside every option, and the choice reads back on the row.
 */
export const ChoosingStatesItsConsequence: Story = {
  args: {
    value: null,
    onChange: () => {},
    exerciseName: "Back Squat",
    resolvesTo: "strict-load",
    preview: { reps: "5", load: "120 kg" },
  },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /back squat/i }));

    const sheet = within(await canvas.findByRole("dialog"));
    // Not four bare labels: each option says what it does.
    await expect(
      sheet.getByText("Only a heavier bar counts. Extra reps at the same weight do not."),
    ).toBeInTheDocument();
    // And the rule is applied to what this movement is actually asked for.
    await expect(sheet.getByText(/This asks for 5 × 120 kg\./)).toBeInTheDocument();

    // Anchored: the DEFAULT option's name also contains "More weight only",
    // because it names what it currently resolves to. That is the copy doing
    // its job, so the selector has to be the precise one.
    await userEvent.click(sheet.getByRole("button", { name: /^More weight only/ }));
    await expect(canvas.getByRole("button", { name: /back squat/i })).toHaveTextContent(
      "More weight only",
    );
  },
}
