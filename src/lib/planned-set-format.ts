/**
 * Pure display helpers for PLANNED set shapes — the pre-parse
 * (`ProgramInputUnparsed`) sets the wger template mapper emits. The sibling of
 * `programs/[id]/derived-format.ts`, which formats the progression engine's
 * `DerivedSet`; that type carries non-optional engine fields (loadKg, rpe,
 * tempo, distanceM, derivedFrom) a planned shape doesn't have, so the two stay
 * separate formatters over one shared visual grammar ("3×8–12", "3×AMRAP",
 * "2×60s", "@ 100 kg"). Kept free of JSX so it unit-tests as plain functions
 * (repo convention for pure modules).
 */
import { kgToDisplay, type WeightUnit } from './units'
import type { ProgramInputUnparsed } from './program-input'

/** One planned set as a lenient mapper emits it (defaults not yet applied). */
export type PlannedSetShape =
  ProgramInputUnparsed['days'][number]['exercises'][number]['sets'][number]

const SECONDS_PER_MINUTE = 60

/** The rep part of a scheme, collapsed when the range is a single number. */
function formatReps(
  repMin: number | null | undefined,
  repMax: number | null | undefined,
): string | null {
  if (repMin != null && repMax != null) {
    return repMin === repMax ? `${repMin}` : `${repMin}–${repMax}`
  }
  const single = repMin ?? repMax
  return single != null ? `${single}` : null
}

/** "90s" off the minute grid or under a minute; "2 min" on it. */
function formatSeconds(seconds: number): string {
  if (seconds >= SECONDS_PER_MINUTE && seconds % SECONDS_PER_MINUTE === 0) {
    return `${seconds / SECONDS_PER_MINUTE} min`
  }
  return `${seconds}s`
}

/**
 * One scheme line for a run of `count` identical planned sets, e.g.
 * "3×8–12", "3×5 @ 100 kg", "3×AMRAP", "2×60s", "3×8 · RIR 2". A rep set
 * with no rep target degrades to "N sets" rather than crashing — upstream
 * templates owe us nothing.
 */
export function formatPlannedScheme(set: PlannedSetShape, count: number, unit: WeightUnit): string {
  let core: string
  if (set.setType === 'amrap') {
    core = `${count}×AMRAP`
  } else if (set.metricMode === 'duration' || set.metricMode === 'duration_distance') {
    core = set.durationSec != null ? `${count}×${formatSeconds(set.durationSec)}` : `${count}×—`
  } else {
    const reps = formatReps(set.repMin, set.repMax)
    core = reps !== null ? `${count}×${reps}` : `${count} set${count === 1 ? '' : 's'}`
  }
  if (set.suggestedLoadKg != null && set.suggestedLoadKg > 0) {
    core += ` @ ${kgToDisplay(set.suggestedLoadKg, unit)} ${unit}`
  }
  const tails = [
    set.rir != null ? `RIR ${set.rir}` : null,
    set.rpe != null ? `RPE ${set.rpe}` : null,
  ].filter(Boolean)
  return [core, ...tails].join(' · ')
}

/**
 * Quiet badges accompanying a scheme line: the logging type when it isn't
 * plain reps×weight, and the planned between-set rest when present.
 */
export function plannedSetChips(set: PlannedSetShape): string[] {
  const chips: string[] = []
  if (set.metricMode === 'duration' || set.metricMode === 'duration_distance') {
    chips.push('Timed')
  }
  if (set.restSec != null && set.restSec > 0) {
    chips.push(`Rest ${formatSeconds(set.restSec)}`)
  }
  return chips
}

/** Everything a scheme line or its chips renders — sets equal on all of it
 *  collapse into one counted run (mirrors `groupDerivedSets`). */
function renderKey(set: PlannedSetShape): string {
  return JSON.stringify([
    set.setType ?? null,
    set.metricMode ?? null,
    set.repMin ?? null,
    set.repMax ?? null,
    set.rir ?? null,
    set.rpe ?? null,
    set.suggestedLoadKg ?? null,
    set.tempo ?? null,
    set.durationSec ?? null,
    set.distanceM ?? null,
    set.restSec ?? null,
    set.technique ?? null,
  ])
}

/** Collapses an exercise's planned sets into runs of identical shapes. */
export function groupPlannedSets(
  sets: readonly PlannedSetShape[],
): { set: PlannedSetShape; count: number }[] {
  const groups: { set: PlannedSetShape; count: number }[] = []
  for (const set of sets) {
    const last = groups[groups.length - 1]
    if (last && renderKey(last.set) === renderKey(set)) {
      groups[groups.length - 1] = { set: last.set, count: last.count + 1 }
    } else {
      groups.push({ set, count: 1 })
    }
  }
  return groups
}
