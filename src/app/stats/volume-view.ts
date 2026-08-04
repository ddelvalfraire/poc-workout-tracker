import type { MuscleGroupVolume } from '@/db/muscle-volume'
import type { PlannedVolume } from '@/db/planned-volume'

/**
 * Pure view helpers for the /stats page — exported for tests, page stays
 * render-only (the stats-view.ts pattern).
 */

/** The weekly floor a trained muscle gets flagged under WHEN NO active
 *  program supplies planned targets (with a plan, the plan is the floor —
 *  see underPlanGroups). The community's usual effective range starts around
 *  10 sets/week; wholly untrained groups are deliberately NOT nagged (an
 *  untouched muscle is a choice, a quietly-slipping one is a surprise).
 *  Fixed in v1. */
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

/** Performed beyond planned × this ratio reads as "well over plan". 1.5 —
 *  half again the prescription — is past incidental extra credit (a bonus
 *  exercise) and into a different week than the program wrote. Fixed in v1;
 *  the note is quiet, never a warning (extra work is a choice). */
export const OVER_PLAN_RATIO = 1.5

/** One group's performed-vs-planned pairing for the flag lines. */
export interface PlanComparisonEntry {
  group: MuscleGroupVolume['group']
  performedSets: number
  plannedSets: number
}

/** Pairs performed groups with their planned figure; 'Other' excluded (the
 *  honesty bucket has no meaningful target) as are groups the plan skips
 *  (planned 0 = the program doesn't train it — not a shortfall). */
function planComparison(
  groups: readonly MuscleGroupVolume[],
  planned: PlannedVolume,
): PlanComparisonEntry[] {
  const plannedByGroup = new Map(planned.groups.map((g) => [g.group, g.plannedSets]))
  return groups
    .filter((g) => g.group !== 'Other')
    .map((g) => ({
      group: g.group,
      performedSets: g.currentSets,
      plannedSets: plannedByGroup.get(g.group) ?? 0,
    }))
    .filter((e) => e.plannedSets > 0)
}

/** Groups short of their planned weekly sets — the muted warning that
 *  replaces the LOW_VOLUME_FLOOR flag when an active program exists. */
export function underPlanGroups(
  groups: readonly MuscleGroupVolume[],
  planned: PlannedVolume,
): PlanComparisonEntry[] {
  return planComparison(groups, planned).filter((e) => e.performedSets < e.plannedSets)
}

/** Groups well past plan (> plannedSets × OVER_PLAN_RATIO) — the quiet note. */
export function overPlanGroups(
  groups: readonly MuscleGroupVolume[],
  planned: PlannedVolume,
): PlanComparisonEntry[] {
  return planComparison(groups, planned).filter(
    (e) => e.performedSets > e.plannedSets * OVER_PLAN_RATIO,
  )
}

/** Performed group volume with `plannedSets` attached for the chart's target
 *  series. When the plan trains 'Other' (untagged exercises) but performance
 *  hasn't hit it, the row is appended so the target still shows. */
export function withPlanned(
  groups: readonly MuscleGroupVolume[],
  planned: PlannedVolume,
): (MuscleGroupVolume & { plannedSets: number })[] {
  const plannedByGroup = new Map(planned.groups.map((g) => [g.group, g.plannedSets]))
  const merged = groups.map((g) => ({ ...g, plannedSets: plannedByGroup.get(g.group) ?? 0 }))
  const plannedOther = plannedByGroup.get('Other') ?? 0
  if (plannedOther > 0 && !groups.some((g) => g.group === 'Other')) {
    merged.push({ group: 'Other', currentSets: 0, previousSets: 0, plannedSets: plannedOther })
  }
  return merged
}

/** Signed "vs last week" caption for the sets tile; null when flat. */
export function setsDeltaLabel(current: number, previous: number): string | null {
  const delta = current - previous
  if (delta === 0) return null
  const sign = delta > 0 ? '+' : '−'
  return `${sign}${Math.abs(delta)} vs last week`
}

/**
 * Display order for the per-group rows/chart: with a plan, biggest shortfall
 * (planned − performed) first — the gap the lifter can still close leads;
 * without one, most-trained first. Array.prototype.sort is stable, so ties
 * keep the catalog's display order. Returns a new array.
 */
export function sortGroupsForDisplay<T extends MuscleGroupVolume & { plannedSets?: number }>(
  groups: readonly T[],
  hasPlan: boolean,
): T[] {
  return [...groups].sort((a, b) =>
    hasPlan
      ? (b.plannedSets ?? 0) - b.currentSets - ((a.plannedSets ?? 0) - a.currentSets)
      : b.currentSets - a.currentSets,
  )
}

/**
 * A bullet-row bar width as a whole percent of its planned track. Capped at
 * 100 — performed beyond plan fills the track, it never overflows it (the
 * over-plan note carries that story). Zero/absent plan yields 0, never
 * NaN/Infinity.
 */
export function bulletWidthPct(value: number, plannedSets: number): number {
  if (plannedSets <= 0) return 0
  return Math.round(Math.min(value / plannedSets, 1) * 100)
}

/** The verdict zone's two lines: editorial headline (CSS uppercases it) plus
 *  one muted context sentence. */
export interface StatsVerdict {
  headline: string
  context: string
}

/**
 * The /stats verdict — the week's status told in words before any chart.
 * Copy table (derived from the plan comparisons already computed for the
 * flag lines; no new queries):
 *   no plan            → "No plan set."       + sets this week (± vs last)
 *   plan, none under   → "On plan."           + every-group line
 *   plan, some under   → "{Group} is behind." (the single WORST shortfall) +
 *                        "{performed} of {planned} planned sets"
 * `daysLeft` (calendar mode only, null otherwise) appends "· N days left
 * this week" — rolling windows have no end to count to.
 */
export function verdictForStats(input: {
  planned: PlannedVolume | null
  under: readonly PlanComparisonEntry[]
  currentSets: number
  previousSets: number
  daysLeft: number | null
}): StatsVerdict {
  const daysLeftSuffix =
    input.daysLeft !== null
      ? ` · ${input.daysLeft} ${input.daysLeft === 1 ? 'day' : 'days'} left this week`
      : ''
  if (input.planned === null) {
    const delta = setsDeltaLabel(input.currentSets, input.previousSets)
    const sets = `${input.currentSets} ${input.currentSets === 1 ? 'set' : 'sets'} this week`
    return {
      headline: 'No plan set.',
      context: `${sets}${delta !== null ? ` · ${delta}` : ''}`,
    }
  }
  if (input.under.length === 0) {
    return {
      headline: 'On plan.',
      context: `Every planned group at its weekly target${daysLeftSuffix}`,
    }
  }
  // The single worst gap names the verdict — one clear instruction, not a
  // list. Ties keep the earlier (catalog-order) group.
  let worst = input.under[0]
  for (const entry of input.under) {
    if (entry.plannedSets - entry.performedSets > worst.plannedSets - worst.performedSets) {
      worst = entry
    }
  }
  return {
    headline: `${worst.group} is behind.`,
    context: `${worst.performedSets} of ${worst.plannedSets} planned sets${daysLeftSuffix}`,
  }
}
