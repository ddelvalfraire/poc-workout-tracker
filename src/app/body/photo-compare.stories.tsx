import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { PhotoCompare } from "./photo-compare";
import type { PhotoEntry } from "./photo-cell";

/**
 * Compare — date A vs date B, in slider or side-by-side mode.
 *
 * The photos here are inline SVG data URLs rather than signed renditions: the
 * story needs real image content under the divider (that is what the focus
 * ring has to stay legible against), not a real photo.
 */
const photo = (id: string, dateLabel: string, hue: number): PhotoEntry => ({
  id,
  dateLabel,
  takenAtMs: 0,
  pose: null,
  note: null,
  // Not a real ThumbHash — the decoder returns null for anything it can't
  // read, and these entries carry their own image anyway.
  thumbHash: "",
  thumbUrl: `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="hsl(${hue} 45% 55%)"/><circle cx="150" cy="150" r="70" fill="hsl(${hue} 60% 78%)"/><rect x="110" y="220" width="80" height="150" rx="24" fill="hsl(${hue} 60% 78%)"/></svg>`,
  )}`,
  displayUrl: null,
});

const LEFT = photo("p1", "12 Mar", 210);
const RIGHT = photo("p2", "20 Aug", 28);

const meta = {
  title: "Body/PhotoCompare",
  component: PhotoCompare,
  parameters: { layout: "padded" },
  args: { left: LEFT, right: RIGHT },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PhotoCompare>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Slider: Story = {}

/**
 * Keyboard focus on the divider must be visible (WCAG 2.4.7). The handle is a
 * real slider — `role="slider"`, `tabIndex={0}`, arrow keys — but it carried a
 * bare `focus-visible:outline-none`, which also cancelled the app-wide
 * `outline-ring/50` fallback, so tabbing onto it showed nothing at all.
 *
 * The ring now rides the circular grip (`group-focus-visible:`), not the
 * full-height strip. This proves it in a real browser: tab onto the slider and
 * assert the grip's ring PAINTS — a computed box-shadow, not a class name.
 */
export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole("slider");
    // By slot, not by child index: the ring rides the grip specifically, and a
    // positional lookup would silently retarget if a span were ever added.
    const grip = slider.querySelector('[data-slot="compare-grip"]');
    if (!(grip instanceof HTMLElement)) throw new Error("compare-grip not found");

    // Unfocused the grip carries only its own drop shadow — no ring.
    await expect(getComputedStyle(grip).boxShadow).not.toContain("3px");

    // The two mode radios come first in the tab order; walk to the slider
    // rather than hard-coding how many stops that is.
    const doc = canvasElement.ownerDocument;
    for (let i = 0; i < 8 && doc.activeElement !== slider; i++) await userEvent.tab();
    await expect(slider).toHaveFocus();

    // Keyboard focus paints the 3px volt ring (ring-3 ring-ring/50)…
    const shadow = getComputedStyle(grip).boxShadow;
    await expect(shadow).toContain("3px");
    // …without dropping the grip's own shadow, which is what keeps the handle
    // readable over a photo in the first place.
    await expect(shadow).toContain("4px");
  },
}

/** `ring-3` — the grip's ring width, which getBoundingClientRect never includes. */
const RING_PX = 3;

/** The grip's border box grown by the ring, i.e. what the eye actually sees. */
function ringBox(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { left: r.left - RING_PX, right: r.right + RING_PX };
}

/** Every ancestor up to `stop` that would crop the ring horizontally. */
function horizontalClippers(el: HTMLElement, stop: HTMLElement) {
  const found: HTMLElement[] = [];
  for (let p = el.parentElement; p && p !== stop.parentElement; p = p.parentElement) {
    if (getComputedStyle(p).overflowX !== "visible") found.push(p);
  }
  return found;
}

/**
 * The focus ring must survive the ends of the track. The grip is centred on the
 * divider, so at value 0 its centre sits exactly on the frame's left edge — and
 * the frame used to be `overflow-hidden`, which cropped half the grip and half
 * its ring. Half an indicator is still 2.4.7-conformant, but it is not what the
 * rest of the app looks like when focused.
 *
 * Asserted by geometry rather than by class: whatever the implementation, the
 * ring box has to fit inside every ancestor that crops horizontally.
 */
export const FocusRingAtExtremes: Story = {
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole("slider");
    const grip = slider.querySelector('[data-slot="compare-grip"]');
    if (!(grip instanceof HTMLElement)) throw new Error("compare-grip not found");

    const doc = canvasElement.ownerDocument;
    for (let i = 0; i < 8 && doc.activeElement !== slider; i++) await userEvent.tab();
    await expect(slider).toHaveFocus();

    // 20 steps of SLIDER_STEP_PERCENT (5) carries 50 to either end.
    for (const [end, key] of [["0", "{ArrowLeft}"], ["100", "{ArrowRight}"]] as const) {
      for (let i = 0; i < 20; i++) await userEvent.keyboard(key);
      await expect(slider).toHaveAttribute("aria-valuenow", end);

      const box = ringBox(grip);
      const clippers = horizontalClippers(grip, canvasElement);
      for (const clipper of clippers) {
        const edge = clipper.getBoundingClientRect();
        await expect(box.left).toBeGreaterThanOrEqual(Math.floor(edge.left));
        await expect(box.right).toBeLessThanOrEqual(Math.ceil(edge.right));
      }
    }
  },
}
