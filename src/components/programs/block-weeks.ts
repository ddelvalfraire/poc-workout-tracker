/**
 * Pure builders for the block map — the ONE shared mesocycle visualization
 * (programs list hero, program detail strip, program stats week rows). Kept
 * free of JSX so it unit-tests as plain functions (repo convention for pure
 * modules). The component that renders these lives in ./block-map.tsx.
 */

/** One week segment of the block map. */
export interface BlockWeek {
  week: number
  /** Distinct program days with a COMPLETED session this week — the fill
   *  numerator. Distinct by day id so historical duplicate rows for one
   *  (day, week) never overfill a segment. */
  dayCountDone: number
  /** The program's planned day count — the fill denominator. */
  dayCountTotal: number
  isDeload: boolean
  isCurrent: boolean
}

/** The workout slice the builder needs — satisfied by ProgramWorkout rows. */
export interface BlockWeekWorkout {
  programDayId: string | null
  programWeek: number | null
  completedAt: Date | null
}

export interface BlockWeeksInput {
  mesocycleWeeks: number
  deloadWeek: number | null
  currentWeek: number
  /** Planned days per week = the program's current day count. */
  dayCountTotal: number
  workouts: readonly BlockWeekWorkout[]
}

/**
 * Derives the week array the block map renders from a program's workout rows.
 * Only COMPLETED workouts with full provenance (day + week) count toward a
 * segment's fill — the same "finished work is the fact worth showing" rule as
 * resolveDayState. The array always spans 1..max(mesocycleWeeks, currentWeek,
 * highest observed completed week): a manually overshot week still shows
 * rather than silently dropping (the program-stats convention).
 */
export function buildBlockWeeks(input: BlockWeeksInput): BlockWeek[] {
  const doneByWeek = new Map<number, Set<string>>()
  let maxObserved = 0
  for (const w of input.workouts) {
    if (w.completedAt === null || w.programWeek === null || w.programDayId === null) continue
    const days = doneByWeek.get(w.programWeek) ?? new Set<string>()
    days.add(w.programDayId)
    doneByWeek.set(w.programWeek, days)
    if (w.programWeek > maxObserved) maxObserved = w.programWeek
  }

  const length = Math.max(1, input.mesocycleWeeks, input.currentWeek, maxObserved)
  return Array.from({ length }, (_, i) => {
    const week = i + 1
    return {
      week,
      dayCountDone: doneByWeek.get(week)?.size ?? 0,
      dayCountTotal: input.dayCountTotal,
      isDeload: week === input.deloadWeek,
      isCurrent: week === input.currentWeek,
    }
  })
}

/** The stats slice the adapter needs — satisfied by ProgramWeekStats rows. */
export interface BlockWeekStats {
  week: number
  daysCompleted: number
  plannedDays: number
}

/**
 * Adapts program-stats week rows (already aggregated by the data layer) to
 * the same BlockWeek shape, so the stats page's per-week segments share the
 * block map's geometry instead of maintaining a third implementation.
 */
export function blockWeeksFromStats(
  weeks: readonly BlockWeekStats[],
  currentWeek: number,
  deloadWeek: number | null,
): BlockWeek[] {
  return weeks.map((w) => ({
    week: w.week,
    dayCountDone: w.daysCompleted,
    dayCountTotal: w.plannedDays,
    isDeload: w.week === deloadWeek,
    isCurrent: w.week === currentWeek,
  }))
}

/**
 * A segment's fill as a whole percent, clamped to 0..100. A zero-day program
 * (or over-counted historical duplicates) yields honest bounds, never
 * NaN/Infinity/overflow.
 */
export function segmentFillPct(dayCountDone: number, dayCountTotal: number): number {
  if (dayCountTotal <= 0) return 0
  return Math.round(Math.min(1, Math.max(0, dayCountDone / dayCountTotal)) * 100)
}
