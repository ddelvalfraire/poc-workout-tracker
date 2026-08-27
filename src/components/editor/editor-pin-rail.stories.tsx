import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PinRail } from "./editor-pin-rail";

/**
 * The editor's authored-vs-derived mark.
 *
 * The thing to check in these stories is that the DERIVED rows are not dimmer,
 * smaller or greyer than the pinned ones. Derived is the unmarked default at
 * full contrast; pinned carries a leading rule. Encoding the difference as
 * lightness was measured at 2.27:1 — under the 3:1 WCAG 1.4.1 asks of a
 * non-colour distinction, and not fixable by tuning the greys.
 *
 * Read the Column story with the page desaturated (or in a greyscale
 * screenshot): the spine of pinned weeks still reads, because the channel is
 * position and the volt is only riding along.
 */
const meta = {
  title: "Editor/PinRail",
  component: PinRail,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PinRail>;

export default meta;
type Story = StoryObj<typeof meta>;

function Row({ pinned, label }: { pinned: boolean; label: string }) {
  return (
    <div className="relative flex items-baseline gap-3 border-b border-b-border/60 py-2 pl-3 text-sm">
      {pinned && <PinRail />}
      <span className="w-14 shrink-0 text-xs uppercase tracking-widest text-muted-foreground tnum">
        {label}
      </span>
      <span className="tnum">3 × 8 · 80 kg · 2 RIR</span>
      {pinned && <span className="ml-auto text-xs text-muted-foreground">Pinned to week 3</span>}
    </div>
  );
}

/** One pinned row beside the unmarked default it has to be told apart from. */
export const Default: Story = {
  render: () => (
    <div className="w-[min(30rem,calc(100vw-2rem))]">
      <Row pinned={false} label="Set 1" />
      <Row pinned label="Set 2" />
      <Row pinned={false} label="Set 3" />
    </div>
  ),
};

/**
 * Why the mark is position: a run of pinned rows reads as a vertical spine at a
 * glance, which no per-row weight or hue change achieves.
 */
export const Column: Story = {
  render: () => (
    <div className="w-[min(30rem,calc(100vw-2rem))]">
      {[false, true, true, true, false, false].map((pinned, index) => (
        <Row key={index} pinned={pinned} label={`Set ${index + 1}`} />
      ))}
    </div>
  ),
};

/**
 * The rail inside a grid cell rather than a list row — the pivot's geometry,
 * where the same mark has to survive a much smaller box.
 */
export const InCell: Story = {
  render: () => (
    <div className="grid w-fit grid-cols-3">
      {[false, true, false, false, false, true].map((pinned, index) => (
        <div
          key={index}
          className="relative border-r border-b border-border/60 py-2 pr-2 pl-3.5 text-sm tnum"
        >
          {pinned && <PinRail className="left-1" />}
          <div>3×8</div>
          <div>{80 + index * 2.5}</div>
        </div>
      ))}
    </div>
  ),
};
