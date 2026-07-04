import { kgToDisplay, type WeightUnit } from '@/lib/units'
import type { DerivedSet } from '@/lib/progression'

/**
 * Pure display helpers for the program detail page's engine-derived targets,
 * kept free of JSX so they unit-test as plain functions (repo convention for
 * pure modules). The page groups an exercise's derived sets into runs of
 * identical prescriptions and renders one target line per run.
 */

/** The rep part of a target, collapsed when the range is a single number. */
function formatReps(repMin: number | null, repMax: number | null): string | null {
  if (repMin !== null && repMax !== null) {
    return repMin === repMax ? `${repMin}` : `${repMin}–${repMax}`
  }
  const single = repMin ?? repMax
  return single !== null ? `${single}` : null
}

/**
 * One target line for a run of `count` identical derived sets, e.g.
 * "3×5 @ 105 kg · RPE 8 · RIR 2 · 3-1-1 tempo", "2×8–12 reps", "3×60s".
 * Null loads render reps-only (an rpe-target scheme with no history has
 * nothing to suggest — no crash).
 */
export function formatTargetLine(set: DerivedSet, count: number, unit: WeightUnit): string {
  const reps = formatReps(set.repMin, set.repMax)
  let core: string
  if (set.metricMode !== 'reps_weight') {
    const duration = set.durationSec !== null ? `${set.durationSec}s` : '—'
    const distance = set.distanceM !== null ? ` / ${set.distanceM} m` : ''
    core = `${count}×${duration}${distance}`
  } else if (set.loadKg !== null) {
    core = `${count}×${reps ?? '?'} @ ${kgToDisplay(set.loadKg, unit)} ${unit}`
  } else {
    core = reps !== null ? `${count}×${reps} reps` : `${count} set${count === 1 ? '' : 's'}`
  }
  const tails = [
    set.rpe !== null ? `RPE ${set.rpe}` : null,
    set.rir !== null ? `RIR ${set.rir}` : null,
    set.tempo !== null ? `${set.tempo} tempo` : null,
  ].filter(Boolean)
  return [core, ...tails].join(' · ')
}

/** Everything a target line (or its badges) renders — sets equal on all of it
 *  may collapse into one counted run. Technique compares structurally. */
function renderKey(set: DerivedSet): string {
  return JSON.stringify([
    set.setType,
    set.metricMode,
    set.repMin,
    set.repMax,
    set.loadKg,
    set.rpe,
    set.rir,
    set.tempo,
    set.durationSec,
    set.distanceM,
    set.technique,
    set.derivedFrom,
  ])
}

/** Collapses an exercise's derived sets into runs of identical prescriptions. */
export function groupDerivedSets(sets: DerivedSet[]): { set: DerivedSet; count: number }[] {
  const groups: { set: DerivedSet; count: number }[] = []
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
