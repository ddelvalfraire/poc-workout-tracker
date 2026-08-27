import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { EditorDayPane } from "./editor-day-pane";
import type {
  EditorDayDetail,
  EditorLoggedExercise,
  EditorLoggedSet,
  EditorSet,
} from "./editor-model";

/**
 * Pane 2 — the addressed day and the sets it prescribes for the selected week.
 *
 * The pair that matters is Default versus Trained. An editable day renders
 * FIELDS; a settled one renders the same values as TEXT at full contrast. That
 * change in form — not a change in lightness — is what encodes the boundary,
 * because lightness alone under 3:1 is not a distinction. Nothing is ever
 * `disabled`, and nothing says "locked": the write would succeed, it would just
 * be inert.
 */
const meta = {
  title: "Editor/EditorDayPane",
  component: EditorDayPane,
  parameters: { layout: "padded" },
} satisfies Meta<typeof EditorDayPane>;

export default meta;
type Story = StoryObj<typeof meta>;

const set = (patch: Partial<EditorSet> & { setNumber: number }): EditorSet => ({
  setType: "working",
  load: 100,
  repMin: 3,
  repMax: 5,
  rir: 2,
  rpe: null,
  overridden: false,
  ...patch,
});

const day: EditorDayDetail = {
  position: 0,
  name: "Push",
  exerciseCount: 2,
  trained: null,
  session: null,
  exercises: [
    {
      position: 0,
      name: "Barbell Bench Press",
      sets: [set({ setNumber: 1 }), set({ setNumber: 2 }), set({ setNumber: 3 })],
    },
    {
      position: 1,
      name: "Overhead Press",
      sets: [
        set({ setNumber: 1, load: 50, repMin: 8, repMax: 8 }),
        set({ setNumber: 2, load: 50, repMin: 8, repMax: 8 }),
      ],
    },
  ],
};

const loggedSet = (
  patch: Partial<EditorLoggedSet> & { setNumber: number },
): EditorLoggedSet => ({
  completed: true,
  reps: 8,
  weight: 80,
  metricMode: "reps_weight",
  durationSec: null,
  distanceM: null,
  prescribedReps: 8,
  prescribedWeight: 80,
  diverged: false,
  ...patch,
});

/** Two movements: one exactly as prescribed, one that came in under it. */
const loggedExercises: EditorLoggedExercise[] = [
  {
    position: 0,
    name: "Barbell Row",
    loggingType: "weight_reps",
    sets: [loggedSet({ setNumber: 1 }), loggedSet({ setNumber: 2 })],
  },
  {
    position: 1,
    name: "Lat Pulldown",
    loggingType: "weight_reps",
    sets: [
      loggedSet({ setNumber: 1, reps: 10, weight: 60, prescribedReps: 10, prescribedWeight: 65, diverged: true }),
      loggedSet({ setNumber: 2, reps: 10, weight: 60, prescribedReps: 10, prescribedWeight: 65, diverged: true }),
      loggedSet({ setNumber: 3, reps: 8, weight: 60, prescribedReps: 10, prescribedWeight: 65, diverged: true }),
    ],
  },
];

const base = {
  day,
  week: 3,
  unit: "kg" as const,
  selectedExercise: null,
  hrefForExercise: (exercise: number) => `?exercise=${exercise}`,
  programId: "00000000-0000-0000-0000-000000000000",
  saveSetAction: () => {},
};

/** Not yet trained: the sets are FIELDS, because the edit will reach them. */
export const Default: Story = { args: base };

/** With an exercise inspected — a rule and weight, no second accent. */
export const ExerciseSelected: Story = { args: { ...base, selectedExercise: 0 } };

/**
 * A completed session, rendered as a LOG of what was actually lifted.
 *
 * These are the SESSION's numbers, not the plan's. Where the two differ the
 * prescription is struck through beside the actual — TrainHeroic's encoding,
 * both facts visible and neither pretending to be a field. Where they agree the
 * row shows one number, so the handful that moved is not buried.
 *
 * Full contrast, no field chrome, never `disabled`: this is the content people
 * most want to read, and dimming it is the WCAG 1.4.3 exemption trap.
 */
export const TrainedDone: Story = {
  args: {
    ...base,
    day: {
      ...day,
      trained: "done",
      session: {
        href: "/workout/example",
        completedSetCount: 5,
        setCount: 5,
        volume: 4820,
        exercises: loggedExercises,
      },
    },
  },
};

/**
 * An IN-PROGRESS session — as frozen as a finished one, because its sets were
 * written when it started and resuming returns them untouched. Nobody would
 * guess that, so the copy says it outright.
 */
export const TrainedInProgress: Story = {
  args: {
    ...base,
    day: {
      ...day,
      trained: "in-progress",
      session: {
        href: "/workout/example",
        completedSetCount: 2,
        setCount: 5,
        volume: 1960,
        exercises: loggedExercises.map((exercise) => ({
          ...exercise,
          sets: exercise.sets.map((entry, index) =>
            index < 2 ? entry : { ...entry, completed: false, reps: null, weight: null },
          ),
        })),
      },
    },
  },
};

/**
 * A settled day whose session could not be read.
 *
 * The plan's rows are NOT substituted here. A template number under "you
 * trained this" would present something the user never lifted as though they
 * had, and no summary at all is the honest answer.
 */
export const TrainedWithoutSession: Story = {
  args: { ...base, day: { ...day, trained: "done", session: null } },
};

/**
 * A session with no sets recorded at all — started, then abandoned.
 *
 * Still settled: its rows were written when it began, so an edit made today
 * cannot reach it either.
 */
export const TrainedSessionEmpty: Story = {
  args: {
    ...base,
    day: {
      ...day,
      trained: "in-progress",
      session: {
        href: "/workout/example",
        completedSetCount: 0,
        setCount: 0,
        volume: 0,
        exercises: [],
      },
    },
  },
};

/**
 * A bodyweight movement — the log reads "BW+10 × 6", the same wording the
 * workout page uses, because both go through the shipped formatter rather than
 * a second one written here.
 */
export const TrainedBodyweight: Story = {
  args: {
    ...base,
    day: {
      ...day,
      trained: "done",
      session: {
        href: "/workout/example",
        completedSetCount: 3,
        setCount: 3,
        volume: 900,
        exercises: [
          {
            position: 0,
            name: "Weighted Pull-Up",
            loggingType: "weighted_bodyweight",
            sets: [
              loggedSet({ setNumber: 1, reps: 6, weight: 10, prescribedWeight: 10 }),
              loggedSet({ setNumber: 2, reps: 6, weight: 10, prescribedWeight: 10 }),
              loggedSet({
                setNumber: 3,
                reps: 5,
                weight: 10,
                prescribedReps: 6,
                prescribedWeight: 10,
                diverged: true,
              }),
            ],
          },
        ],
      },
    },
  },
};

/** A past week's untouched day: "Skipped", and still editable. */
export const Skipped: Story = {
  args: { ...base, week: 1, day: { ...day, trained: "skipped" } },
};

/**
 * A week whose sets are PINNED by hand rather than derived from the rule.
 *
 * The mark is a leading rail plus the word, never a dimmer derived row: the
 * pinned/derived split is a non-colour distinction (WCAG 1.4.1) and lightness
 * alone does not carry one. The word is announced in prose rather than a chip,
 * because it is metadata and pill styling would claim it is pressable.
 *
 * Compare against PinnedEditable below: the same fact, the same rail, on the
 * input side of the settled boundary.
 */
export const WithWeekOverrides: Story = {
  args: {
    ...base,
    day: {
      ...day,
      trained: "done",
      exercises: [
        {
          ...day.exercises[0],
          sets: [
            set({ setNumber: 1, load: 90, overridden: true }),
            set({ setNumber: 2, load: 90, overridden: true }),
            set({ setNumber: 3 }),
          ],
        },
        day.exercises[1],
      ],
    },
  },
};

/** Pounds — loads arrive already converted; the pane never converts. */
export const Pounds: Story = {
  args: {
    ...base,
    unit: "lb",
    day: { ...day, trained: "done", exercises: [day.exercises[0]] },
  },
};

/** A set the template leaves blank says so rather than rendering an empty row. */
export const SetWithNothingPrescribed: Story = {
  args: {
    ...base,
    day: {
      ...day,
      trained: "done",
      exerciseCount: 1,
      exercises: [
        {
          position: 0,
          name: "Barbell Bench Press",
          sets: [
            set({ setNumber: 1 }),
            {
              setNumber: 2,
              setType: "working",
              load: null,
              repMin: null,
              repMax: null,
              rir: null,
              rpe: null,
              overridden: false,
            },
          ],
        },
      ],
    },
  },
};

/** A day with no exercises yet — plain words. */
export const NoExercises: Story = {
  args: {
    ...base,
    day: {
      position: 1,
      name: "Pull",
      exerciseCount: 0,
      trained: null,
      session: null,
      exercises: [],
    },
  },
};

/**
 * No day addressed. Only the wide projection ever renders this — on phone the
 * structure list occupies the column instead — so it is an invitation, not an
 * apology.
 */
export const EmptyCanvas: Story = { args: { ...base, day: null } };

/**
 * The same pins on an UNTRAINED day, so the rows are fields rather than a log.
 *
 * Both projections carry the identical rail in the identical place. That is the
 * point: the settled/editable boundary is a change in FORM, and the
 * pinned/derived one is a change in POSITION, so the two never have to be told
 * apart by the same channel.
 */
export const PinnedEditable: Story = {
  args: {
    ...base,
    day: {
      ...day,
      trained: null,
      exercises: [
        {
          ...day.exercises[0],
          sets: [
            set({ setNumber: 1, load: 90, overridden: true }),
            set({ setNumber: 2, load: 90, overridden: true }),
            set({ setNumber: 3 }),
          ],
        },
        day.exercises[1],
      ],
    },
  },
};
