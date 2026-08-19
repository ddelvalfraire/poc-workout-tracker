import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { MarkdownView } from "./markdown-view";

/**
 * Read-only markdown display — the render half of the notes vocabulary
 * (`NotesEditor` is the write half). Typography follows the muted prose idiom:
 * headings in foreground ink, body at `text-sm` with relaxed leading.
 *
 * It parses a deliberately small subset — headings, lists, paragraphs and
 * inline marks. That is the same subset the editor's schema can produce, so
 * nothing an author writes can fail to render here.
 */
const meta = {
  title: "Components/MarkdownView",
  component: MarkdownView,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MarkdownView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Paragraph: Story = {
  args: {
    markdown:
      "Felt strong off the chest today. Left shoulder tightened on the last set — drop to three working sets next week and revisit.",
  },
}

export const Headings: Story = {
  args: {
    markdown: [
      "## Warm-up",
      "Bar × 10, 60 kg × 5, 80 kg × 3.",
      "### Cues",
      "Elbows tucked, drive the floor away.",
    ].join("\n\n"),
  },
}

export const BulletList: Story = {
  args: {
    markdown: [
      "Focus points:",
      "",
      "- Pause one full second on the chest",
      "- Keep the shoulder blades pinned",
      "- Stop two reps short of failure",
    ].join("\n"),
  },
}

export const NumberedList: Story = {
  args: {
    markdown: [
      "Progression:",
      "",
      "1. Add 2.5 kg when all sets hit the top of the range",
      "2. Hold the weight for a week if any set misses",
      "3. Deload 10% after two stalled weeks",
    ].join("\n"),
  },
}

/** Inline marks — bold, italic, code. */
export const InlineMarks: Story = {
  args: {
    markdown:
      "Work up to a **top single**, then drop to *back-off* sets at `RPE 7`.",
  },
}

/** A full coach note — the realistic case. */
export const CoachNote: Story = {
  args: {
    markdown: [
      "## This week",
      "Volume is up 12% on chest and shoulders. That is a big jump — hold it here rather than adding more.",
      "### Watch",
      "- Left shoulder flagged twice in two weeks",
      "- Sleep averaged 6h1m",
      "",
      "Recommendation: keep **volume flat**, add one full rest day.",
    ].join("\n\n"),
  },
}

/** Empty input renders nothing rather than an empty box. */
export const Empty: Story = { args: { markdown: "" } }
