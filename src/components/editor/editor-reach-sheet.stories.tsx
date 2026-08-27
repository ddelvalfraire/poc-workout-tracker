import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import type { ReachWeek } from "@/app/programs/[id]/editor/reach-view";
import { EditorReachSheet } from "./editor-reach-sheet";

/**
 * "You changed a weight — how far should it reach?"
 *
 * TWO options in every story, and there will never be a third: a pin is keyed
 * `(program_set_id, week)` and holds field values for one week, so nothing in
 * the schema can express "week 3 onward". The footer names the rules that DO
 * vary set count — the deload policy, a weekly-volume progression — rather than
 * leaving someone hunting for an option that cannot exist.
 *
 * The edit is already saved by the time this appears, so "Keep it to this week"
 * is a link that simply stops asking, and only "Move the plan" posts anything.
 */
const meta = {
  title: "Editor/EditorReachSheet",
  component: EditorReachSheet,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EditorReachSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

const week = (patch: Partial<ReachWeek> & { week: number }): ReachWeek => ({
  load: 60,
  changes: false,
  settled: false,
  ...patch,
});

/** The pin as it stands: week 3 alone carries 65, everything else follows. */
const weekOnly: ReachWeek[] = [
  week({ week: 1 }),
  week({ week: 2 }),
  week({ week: 3, load: 65, changes: true }),
  week({ week: 4 }),
  week({ week: 5 }),
  week({ week: 6 }),
];

/** Moving the rule: every week without a pin of its own follows it up. */
const wholePlan: ReachWeek[] = weekOnly.map((entry) => ({ ...entry, load: 65, changes: true }));

const base = {
  exerciseName: "Lat Pulldown",
  week: 3,
  toLoad: 65,
  fromLoad: 60,
  unit: "kg" as const,
  options: [
    { scope: "week" as const, weeks: weekOnly },
    { scope: "plan" as const, weeks: wholePlan },
  ],
  dismissHref: "/programs/p1/editor/0?week=3&exercise=2",
  applyToPlanAction: () => {},
  subject: {
    programId: "00000000-0000-0000-0000-000000000000",
    day: 0,
    exercise: 2,
    setNumber: 1,
    week: 3,
  },
};

/** The artboard's case: 60 → 65 in week 3. */
export const Default: Story = { args: base };

/**
 * Weeks 1–2 already trained.
 *
 * Their numbers are still the PLAN's and are said to be — the sheet states that
 * those sessions keep the targets they started with, so a template figure never
 * passes for something the user lifted.
 */
export const WithTrainedWeeks: Story = {
  args: {
    ...base,
    options: [
      {
        scope: "week",
        weeks: weekOnly.map((entry) => (entry.week <= 2 ? { ...entry, settled: true } : entry)),
      },
      {
        scope: "plan",
        weeks: wholePlan.map((entry) => (entry.week <= 2 ? { ...entry, settled: true } : entry)),
      },
    ],
  },
};

/**
 * Another week was already pinned by hand.
 *
 * Week 5 keeps its own 50 under BOTH options and is not marked as moving. That
 * is the promise every editor surface makes — pinned weeks stay pinned even
 * when you change the rule — and the strip has to show it holding.
 */
export const AnotherWeekPinned: Story = {
  args: {
    ...base,
    options: [
      {
        scope: "week",
        weeks: weekOnly.map((entry) => (entry.week === 5 ? week({ week: 5, load: 50 }) : entry)),
      },
      {
        scope: "plan",
        weeks: wholePlan.map((entry) => (entry.week === 5 ? week({ week: 5, load: 50 }) : entry)),
      },
    ],
  },
};

/** The plan named no weight before — there is a "to", but no "from". */
export const FromNothing: Story = {
  args: {
    ...base,
    fromLoad: null,
    toLoad: 40,
    options: [
      {
        scope: "week",
        weeks: weekOnly.map((entry) =>
          entry.week === 3
            ? week({ week: 3, load: 40, changes: true })
            : week({ ...entry, load: null }),
        ),
      },
      { scope: "plan", weeks: wholePlan.map((entry) => ({ ...entry, load: 40 })) },
    ],
  },
};

/** Pounds — loads arrive converted, and the sentence carries the unit. */
export const Pounds: Story = {
  args: { ...base, unit: "lb", fromLoad: 135, toLoad: 145 },
};
