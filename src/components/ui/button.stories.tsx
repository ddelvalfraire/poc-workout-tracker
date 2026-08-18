import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { VariantProps } from "class-variance-authority";
import { Plus, Trash2 } from "lucide-react";

import { Button, buttonVariants } from "./button";

/**
 * The button role → variant contract (logger UX overhaul, #212):
 *
 * - default             the screen's ONE primary action (solid volt)
 * - band                session-peak action (live Finish): full-bleed
 *                       volt-tinted display-face band — the skin only; the
 *                       -mx gutter bleed is layout and lives at the call site
 * - outline             constructive-additive ("adds something": + Add set,
 *                       + Exercise) and paperwork-primary (Save changes)
 * - ghost               quiet utility (tool rails, sheet close)
 * - reversal            walks something back (Undo, Just today, Use plan as
 *                       written): ghost-quiet with a standing underline
 * - destructive         destructive COMMIT, confirm surfaces only
 * - destructive-outline standing destructive entry point (Discard workout)
 * - secondary / link    shadcn defaults, outside the logger vocabulary
 *
 * Sizes: `default` (44px) and `lg` (48px) clear the HIG touch target and are
 * the only two a primary action may use; `xs`/`sm`/`icon-*` are inline
 * affordances (remove-set, tool rails).
 */
type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

/** Declaration order is the review order: loudest role first. */
const VARIANTS: readonly ButtonVariant[] = [
  "default",
  "band",
  "outline",
  "secondary",
  "ghost",
  "reversal",
  "destructive",
  "destructive-outline",
  "link",
];

const TEXT_SIZES: readonly ButtonSize[] = ["xs", "sm", "default", "lg"];
const ICON_SIZES: readonly ButtonSize[] = [
  "icon-xs",
  "icon-sm",
  "icon",
  "icon-lg",
];

const meta = {
  title: "UI/Button",
  component: Button,
  args: { children: "Start workout" },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "select", options: [...TEXT_SIZES, ...ICON_SIZES] },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every variant at every text size, plus the disabled column. */
export const Matrix: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="flex flex-col gap-4">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex items-center gap-3">
          <span className="w-40 text-xs text-muted-foreground">{variant}</span>
          {TEXT_SIZES.map((size) => (
            <Button key={size} {...args} variant={variant} size={size}>
              Button
            </Button>
          ))}
          <Button {...args} variant={variant} disabled>
            Disabled
          </Button>
        </div>
      ))}
    </div>
  ),
};

/**
 * The band in situ: full width inside a gutter-bled sticky-bar stand-in.
 * The bleed classes stay with the LAYOUT (this wrapper), never the skin.
 */
export const Band: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="w-96 border-t border-border px-5 pt-3 pb-4">
      <Button
        size="lg"
        variant="band"
        className="-mx-5 w-[calc(100%+2.5rem)] font-semibold uppercase tracking-wide"
      >
        Finish workout <span aria-hidden="true">→</span>
      </Button>
    </div>
  ),
};

/** The reversal family next to ghost — the underline is the differentiator. */
export const Reversal: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm" variant="ghost">
        Ghost utility
      </Button>
      <Button size="sm" variant="reversal">
        Undo
      </Button>
      <Button size="sm" variant="reversal">
        Just today
      </Button>
      <Button size="sm" variant="reversal" disabled>
        Undo
      </Button>
    </div>
  ),
};

/** Standing destructive vs destructive commit, side by side. */
export const Destructive: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      <Button variant="destructive-outline" className="w-full">
        Discard workout
      </Button>
      <Button variant="destructive" className="w-full">
        Delete (confirm surface)
      </Button>
    </div>
  ),
};

/**
 * The full size ramp. `default` (44px) and `lg` (48px) are the touch-target
 * sizes; the rest are inline affordances.
 */
export const AllSizes: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="flex flex-col items-start gap-3">
      {TEXT_SIZES.map((size) => (
        <Button key={size} {...args} size={size}>
          {size}
        </Button>
      ))}
      <div className="flex items-center gap-3">
        {ICON_SIZES.map((size) => (
          <Button key={size} {...args} size={size} aria-label={`Add (${size})`}>
            <Plus />
          </Button>
        ))}
      </div>
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true } };

/** Leading/trailing icon slots — `data-icon` tightens the matching padding. */
export const WithIcons: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="flex flex-col items-start gap-3">
      <Button {...args}>
        <Plus data-icon="inline-start" />
        Add exercise
      </Button>
      <Button {...args} variant="destructive">
        <Trash2 data-icon="inline-start" />
        Remove
      </Button>
      <Button {...args} size="icon" aria-label="Add exercise">
        <Plus />
      </Button>
    </div>
  ),
};

/** Primary actions are full-width and thumb-reachable (DESIGN.md § Components). */
export const FullWidthAction: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="w-[calc(100vw-2rem)] max-w-md">
      <Button {...args} size="lg" className="w-full">
        Save workout
      </Button>
    </div>
  ),
};
