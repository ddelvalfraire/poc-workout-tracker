import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { daysBefore, hoursBefore } from "@/components/story-time";

import { WorkoutAmendedMark, WorkoutChangelog } from "./workout-changelog";
import type { WorkoutChangelogEntry } from "./workout-changelog-view";

/**
 * The completed session's paper trail, as it sits under the set rows on the
 * workout summary.
 *
 * The amendments-only default carries the design: the `original` stream is
 * not a log entry; it IS the workout, already rendered as set rows above, so
 * it stays behind "Show the full log". The permanent amended mark that sends
 * a reader here lives above the record — see `AmendedMark` below.
 *
 * Fixtures are anchored to the frozen story clock, never Date.now() — "16
 * Aug · 9:12 AM" has to mean the same pixels tomorrow.
 */
const meta = {
  title: "Components/WorkoutChangelog",
  component: WorkoutChangelog,
  parameters: { layout: "padded" },
  args: {
    sessionAt: new Date(daysBefore(4)),
    locale: "en" as const,
  },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkoutChangelog>;

export default meta;
type Story = StoryObj<typeof meta>;

function entry(overrides: Partial<WorkoutChangelogEntry> = {}): WorkoutChangelogEntry {
  return {
    id: "e1",
    kind: "amendment",
    actor: "ui",
    occurredAt: new Date(daysBefore(2)),
    summary: "Set 3 of Squat — weight 100 → 102.5, reps 5 → 6",
    ...overrides,
  };
}

/** The session's own persist — behind the disclosure in every story below. */
const original = entry({
  id: "original",
  kind: "original",
  occurredAt: new Date(daysBefore(4)),
  summary: "Logged 4 exercises, 14 sets",
});

/**
 * The common case: one correction, made by you, two days after the session.
 * The rail is the strongest of three NEUTRAL steps — an amendment is the kind
 * the reader came for, but the accent for that is spent once, upstream, on
 * the amended mark.
 */
export const OneAmendment: Story = {
  args: { entries: [entry(), original] },
};

/**
 * Several corrections across two days. The date leaves the row into a group
 * header, so every summary gets the full width and wraps rather than
 * truncating mid-sentence.
 *
 * This story is why the rails are not volt: the day grouping renders a
 * SEPARATE list under each header, so a volt rail here would paint two
 * disconnected marks rather than one zone edge — per-item accent down a
 * scannable list (DESIGN.md #163). Each row reads what changed first, the
 * numbers muted behind it, then who and when underneath.
 */
export const AmendmentsOnly: Story = {
  args: {
    entries: [
      entry({ id: "a", occurredAt: new Date(hoursBefore(20)) }),
      entry({
        id: "b",
        occurredAt: new Date(hoursBefore(22)),
        summary: "Set 1 of Bench Press — reps 8 → 6",
      }),
      entry({
        id: "c",
        actor: "coach",
        occurredAt: new Date(daysBefore(2)),
        summary: "Set 5 of Squat — completed no → yes",
      }),
      original,
    ],
  },
};

/**
 * Provenance as a WORD, never a chip: your own edits stay muted, while an
 * agent's or the coach's read in the foreground ink — "someone else touched
 * this record" registers without a pill.
 */
export const EditedByAnAgent: Story = {
  args: {
    entries: [
      entry({ id: "a", actor: "mcp", summary: "Set 2 of Deadlift — weight 140 → 145" }),
      entry({
        id: "b",
        actor: "coach",
        occurredAt: new Date(daysBefore(3)),
        summary: "Set 4 of Deadlift — rir 2 → 1",
      }),
      original,
    ],
  },
};

/**
 * The full log opened: three kinds, three rails, three words — and the rails
 * interleave, which is the second reason they rank in ink rather than accent.
 * Amendment on the strongest neutral rail reading "Corrected", the late entry
 * a step back reading "Added afterwards", and the app's own writes on the
 * ordinary hairline in the system voice — "Automatic", no actor beside it.
 */
export const FullLogExpanded: Story = {
  args: {
    entries: [
      entry({ id: "a" }),
      entry({
        id: "b",
        kind: "system",
        actor: "system",
        occurredAt: new Date(daysBefore(3)),
        summary: "Adopted 102.5 kg into the plan's Squat target",
      }),
      entry({
        id: "c",
        kind: "late_entry",
        occurredAt: new Date(daysBefore(3)),
        summary: "Added Barbell Row, 3 sets",
      }),
      original,
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /show the full log/i }));
    await expect(canvas.getByText(/Added afterwards/i)).toBeInTheDocument();
    await expect(canvas.getByText(/Automatic/i)).toBeInTheDocument();
    await expect(canvas.getByText(/Logged 4 exercises/i)).toBeInTheDocument();
  },
};

/**
 * Nothing was ever amended, so there is nothing to disclose: the section is
 * ABSENT, not an empty state. This story renders an empty canvas on purpose —
 * that blank is the design.
 */
export const NeverAmended: Story = {
  args: {
    entries: [
      original,
      entry({
        id: "s",
        kind: "system",
        actor: "system",
        occurredAt: new Date(daysBefore(4)),
        summary: "Stamped the Consistency trophy",
      }),
    ],
  },
};

/**
 * The permanent amended mark, as it sits above the record on the workout
 * summary — the one thing a reader must meet before the numbers it is about,
 * and the SINGLE volt moment in the whole correction story. The pencil is the
 * same glyph the amended set rows wear; there it renders in neutral ink,
 * because it repeats per row and the accent may not.
 */
export const AmendedMark: StoryObj<typeof WorkoutAmendedMark> = {
  render: (args) => <WorkoutAmendedMark {...args} />,
  args: {
    sessionAt: new Date(daysBefore(4)),
    entries: [entry({ id: "a" }), entry({ id: "b", occurredAt: new Date(daysBefore(2)) }), original],
  },
};

/**
 * One correction, later the same day: the mark says so without a day count —
 * "2 days" when it was four hours would be a small lie on the record.
 */
export const AmendedMarkSameDay: StoryObj<typeof WorkoutAmendedMark> = {
  render: (args) => <WorkoutAmendedMark {...args} />,
  args: {
    sessionAt: new Date(daysBefore(4)),
    entries: [entry({ id: "a", occurredAt: new Date(daysBefore(4) + 3 * 3_600_000) }), original],
  },
};
