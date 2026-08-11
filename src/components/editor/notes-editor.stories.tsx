import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { NotesEditor } from "./notes-editor";

/**
 * The ONE rich-text editor, in two variants: `quick` (bold / italic / lists /
 * links) and `full` (the same marks plus h2/h3 headings).
 *
 * The variant changes **only the toolbar** — the schema is shared, so no
 * variant can drop content another surface authored. That is the whole reason
 * there is one editor instead of two.
 *
 * Markdown in, markdown out: `initialMarkdown` seeds the document and every
 * update reports `editor.getMarkdown()`. Editor JSON never leaves the
 * component.
 *
 * The toolbar sits BELOW the content — Notion's mobile fallback. A fixed bar
 * above the keyboard beats slash menus fighting predictive text.
 *
 * In the app this is always loaded through `next/dynamic`; TipTap must never
 * ride a first-paint bundle.
 */
const meta = {
  title: "Editor/NotesEditor",
  component: NotesEditor,
  parameters: { layout: "padded" },
  args: {
    variant: "quick",
    initialMarkdown: "",
    ariaLabel: "Exercise note",
    onChangeMarkdown: fn(),
  },
  argTypes: { variant: { control: "inline-radio", options: ["quick", "full"] } },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotesEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Quick variant, empty — the QuickCapture surface. */
export const QuickEmpty: Story = {}

export const QuickWithContent: Story = {
  args: {
    initialMarkdown:
      "Felt strong off the chest. **Left shoulder** tight on the last set — drop to 3 working sets next week.",
  },
}

/** Full variant adds h2/h3 to the toolbar; the schema is unchanged. */
export const FullVariant: Story = {
  args: {
    variant: "full",
    ariaLabel: "Program note",
    initialMarkdown: [
      "## Block intent",
      "Hypertrophy focus, 4 weeks, deload in week 4.",
      "### Watch",
      "- Left shoulder",
      "- Sleep under 7h",
    ].join("\n\n"),
  },
}

/**
 * Headings authored in the full editor still render in the quick one — the
 * shared schema means no variant can destroy another's content.
 */
export const QuickPreservesHeadings: Story = {
  args: {
    variant: "quick",
    initialMarkdown: ["## Authored in the full editor", "Body text."].join("\n\n"),
  },
}

export const Autofocused: Story = {
  args: { autofocus: true, initialMarkdown: "Cursor lands here." },
}

/** Long content — the editor grows rather than scrolling internally. */
export const LongNote: Story = {
  args: {
    variant: "full",
    initialMarkdown: [
      "## Session",
      "Worked up to a top single at 120 kg, then three back-off sets at 100 kg.",
      "### Cues that worked",
      "1. Elbows tucked hard",
      "2. Drive the floor away before the bar moves",
      "3. Pause a full second — no bounce",
      "### Next week",
      "Add 2.5 kg to the top single. Hold the back-offs.",
    ].join("\n\n"),
  },
}
