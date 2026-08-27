import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { EditorPanes } from "./editor-panes";

/**
 * The editor's pane projection — the app's ONLY multi-pane layout.
 *
 * The point of this file is the pair of viewports. Every story below passes the
 * SAME props; only the window width changes, and that is the whole of the
 * difference between the two readings DESIGN.md describes. Below 840px the
 * editor is the phone column and `hasDay` decides which single pane you see;
 * at or above it all three are on screen and the inspector stops being a sheet.
 *
 * The panes are filled with labelled blocks rather than the real panes so the
 * LAYOUT is what you are looking at. The real composition is in the
 * EditorStructurePane / EditorDayPane / EditorInspector stories.
 */
const meta = {
  title: "Editor/EditorPanes",
  component: EditorPanes,
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        // The one viewport that crosses `editor-pane-breakpoint` (840px).
        panes: {
          name: "Panes (960×800)",
          styles: { width: "960px", height: "800px" },
          type: "desktop" as const,
        },
      },
    },
  },
} satisfies Meta<typeof EditorPanes>;

export default meta;
type Story = StoryObj<typeof meta>;

function Block({ label, note }: { label: string; note: string }) {
  return (
    <div className="p-4 text-sm">
      <p className="font-display text-base uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-muted-foreground">{note}</p>
    </div>
  );
}

const slots = {
  structure: <Block label="Structure" note="Fixed 244px at the breakpoint." />,
  day: <Block label="Day" note="Fills the flexible middle column." />,
};

/** Phone, no day addressed: the structure list IS the page. */
export const PhoneStructure: Story = {
  args: { ...slots, hasDay: false },
};

/** Phone, a day addressed: drilling in NAVIGATED, so the list is gone. */
export const PhoneDay: Story = {
  args: { ...slots, hasDay: true },
};

/**
 * Phone with something selected: the inspector is a bottom SHEET over the day —
 * the same element that becomes pane 3 at width, never a popover.
 */
export const PhoneDayWithInspector: Story = {
  args: {
    ...slots,
    hasDay: true,
    inspector: <Block label="Inspector" note="A sheet here, a column at width." />,
  },
};

/** At the breakpoint with nothing selected: the inspector COLLAPSES — two
 *  panes, and no empty third column charging width for silence. */
export const PanesCollapsedInspector: Story = {
  args: { ...slots, hasDay: true },
  globals: { viewport: { value: "panes" } },
};

/** At the breakpoint with a selection: three panes, and the SAME `hasDay` that
 *  hid the structure list on phone now hides nothing. */
export const PanesWithInspector: Story = {
  args: {
    ...slots,
    hasDay: true,
    inspector: <Block label="Inspector" note="Fixed 316px, beside the content." />,
  },
  globals: { viewport: { value: "panes" } },
};

/** At the breakpoint with no day addressed: pane 2 is the empty canvas rather
 *  than a missing column — the projection never reflows to two-up. */
export const PanesNoDay: Story = {
  args: { ...slots, hasDay: false },
  globals: { viewport: { value: "panes" } },
};
