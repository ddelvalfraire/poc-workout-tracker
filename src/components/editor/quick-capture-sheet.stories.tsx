import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { QuickCaptureSheet } from "./quick-capture-sheet";

/**
 * The bottom-sheet note editor — the app's one dialog vocabulary: native
 * `<dialog>` + `showModal()`, browser-owned focus trap, manual body scroll
 * lock, animated dismissal, geometric backdrop light-dismiss. A **keep-list**
 * surface (elevation is the point of an overlay).
 *
 * TipTap loads ONLY here, on demand: the editor is a `next/dynamic` import
 * resolved after the sheet mounts, so surfaces that merely SHOW notes ship
 * zero editor bytes. Markdown strings in and out — the sheet never sees editor
 * JSON.
 *
 * `onSave` throwing is a supported path: the sheet stays open and surfaces the
 * error inline, so the user's writing is never lost to a failed request. See
 * `SaveFails`.
 */
const meta = {
  title: "Editor/QuickCaptureSheet",
  component: QuickCaptureSheet,
  parameters: { layout: "fullscreen" },
  args: {
    title: "Bench press",
    eyebrow: "Exercise note",
    initialBody: "",
    initialPinned: false,
    onSave: fn(async () => {}),
    onClose: fn(),
  },
  decorators: [
    (Story) => (
      <div className="min-h-[34rem] bg-background p-5 text-muted-foreground">
        The surface the sheet was raised from.
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QuickCaptureSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewNote: Story = {}

export const EditingExisting: Story = {
  args: {
    initialBody:
      "Pause a full second on the chest. **Elbows tucked** — the flare is what aggravates the left shoulder.",
    initialPinned: true,
  },
}

/** Pinning has no meaning on some surfaces; the control hides entirely. */
export const WithoutPinToggle: Story = {
  args: { showPinToggle: false, initialBody: "A note that cannot be pinned." },
}

/** With a delete affordance — only rendered when `onDelete` is supplied. */
export const Deletable: Story = {
  args: {
    initialBody: "An existing note that can be removed.",
    onDelete: fn(async () => {}),
  },
}

/** The full variant adds headings to the toolbar. */
export const FullEditorVariant: Story = {
  args: {
    variant: "full",
    eyebrow: "Program note",
    title: "Push / Pull / Legs",
    initialBody: ["## Block intent", "Hypertrophy, 4 weeks."].join("\n\n"),
  },
}

/**
 * A failed save keeps the sheet open with an inline error — the user's writing
 * survives and they can retry in place.
 */
export const SaveFails: Story = {
  args: {
    initialBody: "Press Save: this one rejects.",
    onSave: fn(async () => {
      await new Promise((r) => setTimeout(r, 500));
      throw new Error("Couldn't save — you're offline.");
    }),
  },
}
