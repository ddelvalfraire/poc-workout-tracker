import type { MuscleGroupVolume } from '@/db/muscle-volume'
import type { PlannedGroupVolume } from '@/db/planned-volume'

/**
 * Performed volume against planned volume, per muscle group — the weak-point
 * read. Both halves already exist (getMuscleVolume, getPlannedWeeklyVolume);
 * nobody had ever put them beside each other.
 */

export interface GroupBalance {
  group: string
  doneSets: number
  plannedSets: number
  /** doneSets / plannedSets as a percentage, rounded. Uncapped: beating the
   *  plan is information, and clamping it to 100 would make an over-reached
   *  group indistinguishable from an exactly-met one. */
  percent: number
}

export interface VolumeBalance {
  groups: GroupBalance[]
  doneSets: number
  plannedSets: number
  /** The group furthest BELOW plan in absolute sets, or null when every group
   *  has met its plan. Absolute rather than proportional on purpose: being 7
   *  sets short matters more than being 50% short of a 2-set plan. */
  lagging: GroupBalance | null
}

/**
 * Joins the two sides on group name. Groups with no planned volume are
 * dropped: a group the program never asked for cannot be behind on it, and
 * including it would put an unbounded percentage on the chart.
 *
 * Returns null when nothing is planned at all — without a program there is no
 * plan to be measured against.
 */
export function aggregateVolumeBalance(
  performed: readonly MuscleGroupVolume[],
  planned: readonly PlannedGroupVolume[],
): VolumeBalance | null {
  const doneByGroup = new Map(performed.map((g) => [g.group, g.currentSets]))
  const groups: GroupBalance[] = []
  for (const plan of planned) {
    if (plan.plannedSets <= 0) continue
    const doneSets = doneByGroup.get(plan.group) ?? 0
    groups.push({
      group: plan.group,
      doneSets,
      plannedSets: plan.plannedSets,
      percent: Math.round((doneSets / plan.plannedSets) * 100),
    })
  }
  if (groups.length === 0) return null

  let lagging: GroupBalance | null = null
  let worstShortfall = 0
  for (const g of groups) {
    const shortfall = g.plannedSets - g.doneSets
    if (shortfall > worstShortfall) {
      worstShortfall = shortfall
      lagging = g
    }
  }
  return {
    groups,
    doneSets: groups.reduce((n, g) => n + g.doneSets, 0),
    plannedSets: groups.reduce((n, g) => n + g.plannedSets, 0),
    lagging,
  }
}
