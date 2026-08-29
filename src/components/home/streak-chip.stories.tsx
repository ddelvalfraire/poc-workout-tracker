import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { StreakChip } from "./streak-chip";

/**
 * The streak flame — honest gamification's one ornament: a count of real weeks
 * trained to schedule (within the goal's own grace), nothing invented.
 *
 * Weeks are the USER'S calendar weeks, so the count is computed client-side
 * after mount — the server's week boundary is not the user's. Two deliberate
 * silences follow from that: it renders **nothing** before mount, and
 * **nothing** for a zero streak. An unlit flame is noise, not motivation.
 *
 * The stories below synthesise completions relative to "now", so the chip
 * shows a live streak whenever you open them.
 */
// StreakChip computes the streak against the REAL clock on mount (local
// calendar weeks, by design), so its fixtures have to be relative to now.
// A frozen epoch would yield a zero streak and the component renders null.
const meta = {
  title: "Components/StreakChip",
  component: StreakChip,
} satisfies Meta<typeof StreakChip>;

export default meta;
type Story = StoryObj<typeof meta>;

const DAY_MS = 86_400_000;

/**
 * Completions for the last `weeks` calendar weeks, on each scheduled weekday,
 * skipping anything still in the future.
 */
function completionsFor(weeks: number, weekdays: number[]): number[] {
  const now = new Date();
  const startOfThisWeek = new Date(now);
  startOfThisWeek.setHours(12, 0, 0, 0);
  startOfThisWeek.setDate(startOfThisWeek.getDate() - startOfThisWeek.getDay());

  const times: number[] = [];
  for (let w = weeks - 1; w >= 0; w -= 1) {
    for (const weekday of weekdays) {
      const t = startOfThisWeek.getTime() - w * 7 * DAY_MS + weekday * DAY_MS;
      if (t <= now.getTime()) times.push(t);
    }
  }
  return times;
}

const SCHEDULE = [1, 3, 5]; // Mon / Wed / Fri

export const SixWeeks: Story = {
  args: {
    scheduledWeekdays: SCHEDULE,
    allowedMissesPerWeek: 0,
    completedAtTimes: completionsFor(6, SCHEDULE),
  },
}

export const OneWeek: Story = {
  args: {
    scheduledWeekdays: SCHEDULE,
    allowedMissesPerWeek: 0,
    completedAtTimes: completionsFor(1, SCHEDULE),
  },
}

export const LongStreak: Story = {
  args: {
    scheduledWeekdays: SCHEDULE,
    allowedMissesPerWeek: 1,
    completedAtTimes: completionsFor(28, SCHEDULE),
  },
}

/**
 * Grace absorbs a miss: only two of three scheduled days trained, but the
 * goal allows one miss per week, so the streak survives.
 */
export const WithGrace: Story = {
  args: {
    scheduledWeekdays: SCHEDULE,
    allowedMissesPerWeek: 1,
    completedAtTimes: completionsFor(5, [1, 3]),
  },
}

/**
 * Zero streak renders NOTHING — the canvas below is intentionally empty.
 * This is the contract, not a broken story.
 */
export const ZeroStreakRendersNothing: Story = {
  args: {
    scheduledWeekdays: SCHEDULE,
    allowedMissesPerWeek: 0,
    completedAtTimes: [],
  },
  render: (args) => (
    <div className="flex flex-col items-center gap-3">
      <div className="flex min-h-8 items-center rounded border border-dashed border-border/60 px-6 text-sm text-muted-foreground">
        <StreakChip {...args} />
        <span className="italic">(nothing rendered)</span>
      </div>
    </div>
  ),
}

/** In place: beside a page title, which is where the flame actually lives. */
export const InContext: Story = {
  args: {
    scheduledWeekdays: SCHEDULE,
    allowedMissesPerWeek: 0,
    completedAtTimes: completionsFor(6, SCHEDULE),
  },
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="flex w-[min(28rem,calc(100vw-2rem))] items-center gap-3">
      <h1 className="text-xl uppercase tracking-tight">Consistency</h1>
      <StreakChip {...args} />
    </div>
  ),
}
