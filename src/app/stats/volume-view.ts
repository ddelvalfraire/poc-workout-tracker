import type { MuscleGroupVolume } from '@/db/muscle-volume'

/**
 * Pure view helpers for the /stats page — exported for tests, page stays
 * render-only (the stats-view.ts pattern).
 */

/** The weekly floor a trained muscle gets flagged under. The community's
 *  usual effective range starts around 10 sets/week; wholly untrained groups
 *  are deliberately NOT nagged (an untouched muscle is a choice, a
 *  quietly-slipping one is a surprise). Fixed in v1. */
export const LOW_VOLUME_FLOOR = 10

/** Groups that are ACTIVE (either window) but under the floor this week. */
export function lowVolumeGroups(
  groups: readonly MuscleGroupVolume[],
  floor: number = LOW_VOLUME_FLOOR,
): MuscleGroupVolume[] {
  return groups.filter(
    (g) =>
      g.group !== 'Other' && g.currentSets < floor && (g.currentSets > 0 || g.previousSets > 0),
  )
}

/** Signed "vs last week" caption for the sets tile; null when flat. */
export function setsDeltaLabel(current: number, previous: number): string | null {
  const delta = current - previous
  if (delta === 0) return null
  const sign = delta > 0 ? '+' : '−'
  return `${sign}${Math.abs(delta)} vs last week`
}
