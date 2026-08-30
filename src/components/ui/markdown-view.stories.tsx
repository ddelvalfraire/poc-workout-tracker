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

/**
 * The five GitHub alert types, each mapped onto a status colour the app
 * already ships. No new palette enters a document.
 */
export const Alerts: Story = {
  args: {
    markdown: [
      "> [!NOTE]",
      "> Days are ordered but not dated. Run them in sequence.",
      "",
      "> [!TIP]",
      "> Set the bar height once and leave it. Fiddling costs a working set.",
      "",
      "> [!IMPORTANT]",
      "> Seed your training maxes before week 1 or every percentage is guesswork.",
      "",
      "> [!WARNING]",
      "> Do not run this block into a meet.",
      "",
      "> [!CAUTION]",
      "> Skipping the deload week will end this block early. It is not optional.",
    ].join("\n"),
  },
}

/**
 * Tables get hairlines only — no vertical rules, no zebra — and a trailing
 * colon in the delimiter row marks a column numeric, which buys it tabular
 * figures and right alignment so digits compare down the column.
 */
export const Table: Story = {
  args: {
    markdown: [
      "| Week | Focus | Top set | Sets |",
      "| --- | --- | ---: | ---: |",
      "| 1–2 | Accumulate | 70% | 18 |",
      "| 3–4 | Intensify | 80% | 22 |",
      "| 5 | Deload | 60% | 10 |",
      "| 6 | Test | 90%+ | 12 |",
    ].join("\n"),
  },
}

/** A blockquote is a left rule and an indent: no fill, no italic. */
export const Blockquote: Story = {
  args: {
    markdown:
      "> The deficit is the stimulus you are managing. The barbell is just how you keep what you have.",
  },
}

/**
 * The program article at its reading step — the About route passes a larger
 * type scale, so the subset has to hold up at 18px as well as at 14px.
 */
export const ProgramArticle: Story = {
  args: {
    className: "max-w-prose text-lg leading-7 text-foreground/90",
    markdown: [
      "Six weeks of high-frequency squat volume, run in a deficit. The point is not to add weight to the bar — it is to **hold your strength while the scale moves**.",
      "## How to run it",
      "Four days a week, two upper and two lower. Weeks 1–4 build, week 5 deloads, week 6 tests.",
      "- Squat and bench carry a training max. Everything else is double progression.",
      "- Leave the last set of accessories one rep short.",
      "> [!WARNING]",
      "> Do not run this block into a meet.",
      "#### Substitutions",
      "Swap freely inside a pattern. Keep the `rep range` and the RIR.",
    ].join("\n\n"),
  },
}
