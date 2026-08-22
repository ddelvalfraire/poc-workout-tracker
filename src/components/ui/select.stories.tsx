import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from "./select";

/**
 * The app's select, on Base UI's accessible primitive.
 *
 * The native control was replaced because the option list is drawn by the OS:
 * it ignores the palette, the type scale and the dark theme, becomes a
 * full-height wheel on iOS that hides the form behind it, and — the reason that
 * actually forced it — an `<option>` has nowhere to put the sentence that makes
 * a choice comprehensible. Half the choices in the program editor are
 * unintelligible without one.
 *
 * The trigger is `Input`'s class list: 44px tall, 16px text. A select and a text
 * field in the same form are one object with different innards.
 *
 * Every story passes `items`, because that is how a value resolves to its label
 * — without it the trigger shows `percent-1rm` instead of "Percent of 1RM".
 */
const meta = {
  title: "UI/Select",
  component: SelectTrigger,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(22rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SelectTrigger>;

export default meta;
type Story = StoryObj<typeof meta>;

const weeks = [3, 4, 5, 6, 8, 12].map((n) => ({ label: `${n} weeks`, value: String(n) }));

const schemes = [
  {
    label: "Linear",
    value: "linear",
    hint: "Add a fixed amount each week.",
  },
  {
    label: "Percent of 1RM",
    value: "percent-1rm",
    hint: "Loads come from a training max you set per lift.",
  },
  {
    label: "AMRAP cycle",
    value: "amrap-cycle",
    hint: "Last set to failure, then the training max moves on what you hit.",
  },
  {
    label: "Weekly volume",
    value: "weekly-volume",
    hint: "Sets climb across the block, load holds.",
  },
];

const noProgression = { label: "No progression", value: "none", hint: "Nothing changes week to week." };

/** The plain case: short labels that need no explaining. */
export const Default: Story = {
  render: () => (
    <Select items={weeks} defaultValue="6">
      <SelectLabel>Block length</SelectLabel>
      <SelectTrigger className="mt-1.5" />
      <SelectContent>
        {weeks.map(({ label, value }) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
};

/**
 * The case that justifies the component. Every progression scheme is a term of
 * art, and the hint is the difference between choosing and guessing.
 */
export const WithHints: Story = {
  render: () => (
    <Select items={[...schemes, noProgression]} defaultValue="linear">
      <SelectLabel>Progression</SelectLabel>
      <SelectTrigger className="mt-1.5" placeholder="Pick a rule" />
      <SelectContent>
        {schemes.map(({ label, value, hint }) => (
          <SelectItem key={value} value={value} hint={hint}>
            {label}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={noProgression.value} hint={noProgression.hint}>
          {noProgression.label}
        </SelectItem>
      </SelectContent>
    </Select>
  ),
};

/** Nothing chosen yet — the placeholder is muted, not a fake selection. */
export const Placeholder: Story = {
  render: () => {
    const items = [4, 5, 6].map((n) => ({ label: `Week ${n}`, value: String(n) }));
    return (
      <Select items={items}>
        <SelectLabel>Deload week</SelectLabel>
        <SelectTrigger className="mt-1.5" placeholder="No deload" />
        <SelectContent>
          {items.map(({ label, value }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  },
};

/**
 * Grouped, with a trailing value and a disabled option that says WHY it is
 * disabled — another thing `<option disabled>` cannot express.
 */
export const GroupedWithTrailing: Story = {
  render: () => {
    const items = [
      { label: "Barbell Bench Press", value: "bench" },
      { label: "Overhead Press", value: "ohp" },
      { label: "Barbell Row", value: "row" },
      { label: "Weighted Pull-Up", value: "pullup" },
    ];
    return (
      <Select items={items} defaultValue="bench">
        <SelectLabel>Movement</SelectLabel>
        <SelectTrigger className="mt-1.5" />
        <SelectContent>
          <SelectGroup label="Push">
            <SelectItem value="bench" trailing="100 kg">
              Barbell Bench Press
            </SelectItem>
            <SelectItem value="ohp" trailing="60 kg">
              Overhead Press
            </SelectItem>
          </SelectGroup>
          <SelectGroup label="Pull">
            <SelectItem value="row" trailing="80 kg">
              Barbell Row
            </SelectItem>
            <SelectItem value="pullup" disabled hint="Already in this day.">
              Weighted Pull-Up
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  },
};

/**
 * 32px. Only for the editor inspector at >=840px, where DESIGN.md permits
 * leaving the 44px floor "where the input is a pointer". Never phone-reachable.
 *
 * No visible label here, so the trigger carries `aria-label` — a selected value
 * is content, not an accessible name.
 */
export const Dense: Story = {
  render: () => {
    const items = [
      { label: "Kilograms", value: "kg" },
      { label: "Pounds", value: "lb" },
    ];
    return (
      <Select items={items} defaultValue="kg">
        <SelectTrigger dense aria-label="Weight unit" />
        <SelectContent>
          {items.map(({ label, value }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <Select items={schemes} defaultValue="linear" disabled>
      <SelectLabel>Progression</SelectLabel>
      <SelectTrigger className="mt-1.5" />
      <SelectContent>
        <SelectItem value="linear">Linear</SelectItem>
      </SelectContent>
    </Select>
  ),
};

/**
 * Opens by keyboard and closes by keyboard — the accessibility the native
 * control gave away for free, which is the whole reason this wraps a primitive
 * instead of being a styled div.
 *
 * The first assertion is the regression guard for a real bug: without `items`
 * the trigger rendered the raw value `linear` instead of "Linear".
 */
export const KeyboardOperable: Story = {
  render: () => (
    <Select items={schemes} defaultValue="linear">
      <SelectLabel>Progression</SelectLabel>
      <SelectTrigger className="mt-1.5" />
      <SelectContent>
        {schemes.slice(0, 2).map(({ label, value, hint }) => (
          <SelectItem key={value} value={value} hint={hint}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox");

    await step("the trigger shows the LABEL, never the wire value", async () => {
      await expect(trigger).toHaveTextContent("Linear");
      await expect(trigger).not.toHaveTextContent("linear");
    });

    await step("opens from the keyboard", async () => {
      trigger.focus();
      await userEvent.keyboard("{Enter}");
      // The listbox portals out of canvasElement, so query the document.
      const listbox = await within(document.body).findByRole("listbox");
      await expect(listbox).toBeInTheDocument();
    });

    await step("Escape closes and returns focus to the trigger", async () => {
      await userEvent.keyboard("{Escape}");
      await expect(trigger).toHaveFocus();
    });
  },
};
