/**
 * A frozen instant for story fixtures. Story-only — nothing in the app imports
 * this.
 *
 * Stories that build fixtures from `Date.now()` render differently on every
 * run, which makes the catalog unreproducible and rules out visual regression
 * at the breakpoints the project's testing rules require. Anchoring to a fixed
 * epoch keeps "3h ago" meaning the same pixels tomorrow.
 *
 * 2026-01-15T09:00:00Z — a Thursday morning, so weekday-formatted fixtures
 * read naturally and nothing lands on a month or year boundary.
 */
export const STORY_NOW = Date.UTC(2026, 0, 15, 9, 0, 0);

/** `STORY_NOW` minus a whole number of days, as a timestamp. */
export function daysBefore(days: number): number {
  return STORY_NOW - days * 86_400_000;
}

/** `STORY_NOW` minus a whole number of hours, as a timestamp. */
export function hoursBefore(hours: number): number {
  return STORY_NOW - hours * 3_600_000;
}
