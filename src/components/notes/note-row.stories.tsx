import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DividerList } from "@/components/ui/divider-list";

import { NoteRow } from "./note-row";
import type { NoteView } from "./note-view";

/**
 * One note row in the de-card vocabulary (notes v2): caps anchor breadcrumb,
 * right-aligned relative write-time, plain-text body with inline #tags in the
 * volt, micro-snapshot line beneath.
 *
 * The row is an `<li>` and owns NO hairline — the enclosing DividerList draws
 * them. Every story here wraps in DividerList for that reason; a row rendered
 * bare is a row missing half its anatomy.
 */
const meta = {
  title: "Notes/NoteRow",
  component: NoteRow,
  parameters: { layout: "padded" },
  decorators: [
    // NoteRow is an <li>, so it needs a list ancestor to be valid. Stories that
    // build their own list set `ownsList` — a <ul> inside a <ul> is invalid.
    (Story, context) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        {context.parameters.ownsList ? <Story /> : <DividerList><Story /></DividerList>}
      </div>
    ),
  ],
} satisfies Meta<typeof NoteRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Fixtures are frozen, never `Date.now()` — `timeLabel` is pre-formatted by
 * `buildNoteView`, so a story only has to pick the string it wants to show.
 */
const note = (overrides: Partial<NoteView> = {}): NoteView => ({
  id: "note-1",
  author: "user",
  anchorKind: "set",
  outdated: false,
  breadcrumb: "Bench Press · Set 3",
  body: "Felt heavy off the chest, elbows flared. #form",
  snapshotLine: "185 lb × 6",
  timeLabel: "2h ago",
  threadKey: "workout-1",
  threadTitle: "Push A",
  threadDateLabel: "Tuesday",
  exerciseName: "Bench Press",
  programName: null,
  workoutId: "workout-1",
  tags: ["form"],
  ...overrides,
});

/** The full anatomy: breadcrumb, time, body with a volt tag, snapshot line. */
export const Default: Story = { args: { note: note() } };

/** No anchor data to echo — the snapshot line is omitted, not faked. */
export const WithoutSnapshot: Story = {
  args: { note: note({ snapshotLine: null, body: "Good session overall." }) },
};

/**
 * The set was edited after the note was written. GitHub outdated-comment
 * semantics: the frozen context becomes the evidence ("was 35 lb × 8").
 * "Outdated" is a fact, so it is a quiet caps WORD — never a chip.
 */
export const Outdated: Story = {
  args: {
    note: note({
      outdated: true,
      breadcrumb: "Smith Lunge · Set 2",
      snapshotLine: "35 lb × 8",
      body: "Subbed for Bulgarians, knee was cranky.",
    }),
  },
};

/**
 * Coach authorship wears presence, never a chat bubble: 17px avatar + name
 * above the breadcrumb and a volt LEFT hairline down the row.
 */
export const CoachAuthor: Story = {
  args: {
    note: note({
      id: "note-coach",
      author: "coach",
      body: "Own the eccentric — three seconds down. #cue",
      tags: ["cue"],
    }),
  },
};

/** Several tags inline — the volt marks the grammar, not the emphasis. */
export const MultipleTags: Story = {
  args: {
    note: note({
      body: "Bar path drifted forward. #form #cue Retest next week. #followup",
      tags: ["form", "cue", "followup"],
    }),
  },
};

/** Long breadcrumb and long body — truncation on the caps line, wrap below. */
export const LongContent: Story = {
  args: {
    note: note({
      breadcrumb: "Incline Dumbbell Bench Press (Neutral Grip) · Set 4",
      body: "Shoulder felt fine on the way up but the lockout was slow. Dropped the last set to keep the bar speed honest rather than grinding a rep that would have cost the next session. #form #load",
      snapshotLine: "70 lb × 9",
      tags: ["form", "load"],
    }),
  },
};

/** How the surface actually reads: a run of rows sharing one DividerList. */
export const InAList: Story = {
  parameters: { layout: "padded", ownsList: true },
  // `render` ignores args, but NoteRow's `note` prop is required so the story
  // type demands one. The list below supplies its own rows.
  args: { note: note() },
  render: () => (
    <DividerList>
      <NoteRow note={note()} />
      <NoteRow
        note={note({
          id: "note-2",
          author: "coach",
          breadcrumb: "Push A · Session",
          body: "Solid work. Hold this load next week. #plan",
          snapshotLine: null,
          timeLabel: "1h ago",
          tags: ["plan"],
        })}
      />
      <NoteRow
        note={note({
          id: "note-3",
          outdated: true,
          breadcrumb: "Smith Lunge · Set 2",
          snapshotLine: "35 lb × 8",
          body: "Subbed for Bulgarians.",
          timeLabel: "Yesterday",
        })}
      />
    </DividerList>
  ),
};
