/**
 * Pure logic for the program detail page's week view — kept free of JSX so it
 * unit-tests as plain functions (same convention as ./derived-format).
 */

/**
 * The `?week=` search param as a usable week number. The URL is user-editable
 * state, so everything is defended: repeated params take the first value,
 * non-numeric input falls back to `currentWeek` (the week the user is actually
 * in — the page's default), and out-of-range numbers clamp into
 * 1..mesocycleWeeks rather than 404ing a shared/stale link.
 */
export function parseWeekParam(
  raw: string | string[] | undefined,
  currentWeek: number,
  mesocycleWeeks: number,
): number {
  const first = Array.isArray(raw) ? raw[0] : raw
  const parsed = first !== undefined ? parseInt(first, 10) : NaN
  if (Number.isNaN(parsed)) return currentWeek
  return Math.min(Math.max(parsed, 1), Math.max(1, mesocycleWeeks))
}

/** What a day card renders for the selected week, and which workout backs it. */
export interface DayWeekState<T> {
  state: 'completed' | 'in-progress'
  workout: T
}

/**
 * Resolves a day's state for one (day, week) from its workout rows. Multiple
 * rows per (day, week) are possible historically — resume-on-start now
 * prevents new duplicates, but old data may carry them — so the pick is
 * deterministic: a completed row beats any in-progress one (finished work is
 * the fact worth showing; an abandoned restart shouldn't hide the result),
 * and within a state the freshest `startedAt` wins. No rows → null (the day
 * hasn't been touched this week).
 */
export function resolveDayState<T extends { startedAt: Date; completedAt: Date | null }>(
  rows: T[],
): DayWeekState<T> | null {
  const freshest = (candidates: T[]): T | null =>
    candidates.length > 0
      ? candidates.reduce((a, b) => (b.startedAt.getTime() > a.startedAt.getTime() ? b : a))
      : null

  const completed = freshest(rows.filter((r) => r.completedAt !== null))
  if (completed) return { state: 'completed', workout: completed }

  const inProgress = freshest(rows.filter((r) => r.completedAt === null))
  if (inProgress) return { state: 'in-progress', workout: inProgress }

  return null
}
