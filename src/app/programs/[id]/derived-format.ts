import { kgToDisplay, type WeightUnit } from '@/lib/units'
import type { DerivedSet } from '@/lib/progression'
import type { Message } from '@/lib/message'
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config'

/**
 * Pure display helpers for the program detail page's engine-derived targets,
 * kept free of JSX so they unit-test as plain functions (repo convention for
 * pure modules). The page groups an exercise's derived sets into runs of
 * identical prescriptions and renders one target line per run.
 *
 * Copy is returned as message DESCRIPTORS (I18N-KEYS §9); loads, durations
 * and distances are formatted by `Intl` in the resolved locale, so "105 kg"
 * and "60s" carry their unit labels without ever entering the catalog.
 */

/** The rep part of a target, collapsed when the range is a single number.
 *  A range is two NUMBERS around an en dash, so both go through Intl. */
function formatReps(repMin: number | null, repMax: number | null, locale: Locale): string | null {
  const n = new Intl.NumberFormat(locale)
  if (repMin !== null && repMax !== null) {
    return repMin === repMax ? n.format(repMin) : `${n.format(repMin)}–${n.format(repMax)}`
  }
  const single = repMin ?? repMax
  return single !== null ? n.format(single) : null
}

function formatUnitValue(value: number, unit: string, locale: Locale, narrow = false): string {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: narrow ? 'narrow' : 'short',
  }).format(value)
}

export type TargetLineKey =
  | 'target.timed'
  | 'target.load'
  | 'target.reps'
  | 'target.sets'
  | 'target.rpe'
  | 'target.rir'
  | 'target.tempo'

/**
 * One target line for a run of `count` identical derived sets, e.g.
 * "3×5 @ 105 kg · RPE 8 · RIR 2 · 3-1-1 tempo", "2×8–12 reps", "3×60s",
 * returned as the ORDERED SEGMENTS the caller joins with " · ". Null loads
 * render reps-only (an rpe-target scheme with no history has nothing to
 * suggest — no crash).
 *
 * Segments rather than one message because the tails are independent chips
 * that come and go individually; each is a self-contained phrase, so nothing
 * here is a sentence assembled from fragments.
 */
export function formatTargetLine(
  set: DerivedSet,
  count: number,
  unit: WeightUnit,
  locale: Locale = DEFAULT_LOCALE,
): Message<TargetLineKey>[] {
  const reps = formatReps(set.repMin, set.repMax, locale)
  let core: Message<TargetLineKey>
  if (set.metricMode !== 'reps_weight') {
    core = {
      key: 'target.timed',
      values: {
        count,
        // 'none' rather than an em dash baked in: an unset duration is a
        // missing value, and the catalog owns how a missing value reads.
        duration:
          set.durationSec !== null
            ? formatUnitValue(set.durationSec, 'second', locale, true)
            : 'none',
        distance:
          set.distanceM !== null ? formatUnitValue(set.distanceM, 'meter', locale) : 'none',
      },
    }
  } else if (set.loadKg !== null) {
    core = {
      key: 'target.load',
      values: {
        count,
        reps: reps ?? 'none',
        load: formatUnitValue(
          kgToDisplay(set.loadKg, unit),
          unit === 'kg' ? 'kilogram' : 'pound',
          locale,
        ),
      },
    }
  } else if (reps !== null) {
    core = { key: 'target.reps', values: { count, reps } }
  } else {
    core = { key: 'target.sets', values: { count } }
  }
  return [
    core,
    ...(set.rpe !== null ? [{ key: 'target.rpe' as const, values: { rpe: set.rpe } }] : []),
    ...(set.rir !== null ? [{ key: 'target.rir' as const, values: { rir: set.rir } }] : []),
    // The tempo notation ("3-1-1") is a domain code, not copy — only the
    // word after it is a message.
    ...(set.tempo !== null
      ? [{ key: 'target.tempo' as const, values: { tempo: set.tempo } }]
      : []),
  ]
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
