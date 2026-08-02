/**
 * Pure helpers for the /ops/product activity log. Kept apart from
 * product-analytics.ts on purpose: that module imports the db (server-only),
 * while the filter below runs inside the client island's chips. Everything
 * here is data-in/data-out so both sides can share one contract.
 */

export type ActivityType =
  | 'program'
  | 'workout'
  | 'goal'
  | 'photo'
  | 'measurement'
  | 'bodyweight'

export interface ActivityItem {
  type: ActivityType
  /** Pre-composed display line ("[coach] Adjusted week 2 volume"). */
  line: string
  at: Date
}

/** Chip order + badge labels for the client island. */
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  workout: 'Workouts',
  program: 'Programs',
  goal: 'Goals',
  photo: 'Photos',
  measurement: 'Measurements',
  bodyweight: 'Bodyweight',
}

export const ACTIVITY_TYPES = Object.keys(ACTIVITY_TYPE_LABELS) as ActivityType[]

/** How many merged rows the log keeps — mirrors each source read's LIMIT. */
export const ACTIVITY_LIMIT = 50

/**
 * Merges per-source newest-first reads into one newest-first log capped at
 * `limit`. Ties keep their relative source order (stable sort); inputs are
 * not mutated.
 */
export function mergeActivity(
  sources: readonly (readonly ActivityItem[])[],
  limit: number = ACTIVITY_LIMIT,
): ActivityItem[] {
  return sources
    .flat()
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit)
}

/**
 * Chip filter: an empty selection means "no filter" (show everything), so
 * deselecting the last chip never blanks the log.
 */
export function filterActivity(
  items: readonly ActivityItem[],
  active: ReadonlySet<ActivityType>,
): ActivityItem[] {
  if (active.size === 0) return [...items]
  return items.filter((item) => active.has(item.type))
}
