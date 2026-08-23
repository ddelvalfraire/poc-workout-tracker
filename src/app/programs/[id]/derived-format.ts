import { kgToDisplay, type WeightUnit } from '@/lib/units'
import type { DerivedSet } from '@/lib/progression'
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

/** The label key for a mark riding the SETS cell. */
export type TargetMarkKey =
  | 'day.deloadLabel'
  | 'day.technique.dropSet'
  | 'day.technique.restPause'
  | 'day.technique.myoReps'
  | 'day.technique.cluster'

/**
 * A two-letter mark that rides the SETS cell rather than becoming a trailing
 * badge — the set-number slot doubles as the type slot, so a technique or a
 * deload costs no extra column and no pill shell.
 *
 * Two letters, not one: "drop set" and "deload" both start with D, and a mark
 * that collides teaches nothing. DL already means deload in the block map, so
 * the same pair means the same thing in both places.
 */
export interface TargetMark {
  letter: string
  key: TargetMarkKey
}

const TECHNIQUE_MARK = {
  'drop-set': { letter: 'DS', key: 'day.technique.dropSet' },
  'rest-pause': { letter: 'RP', key: 'day.technique.restPause' },
  'myo-reps': { letter: 'MR', key: 'day.technique.myoReps' },
  cluster: { letter: 'CL', key: 'day.technique.cluster' },
} as const satisfies Record<string, TargetMark>

const DELOAD_MARK: TargetMark = { letter: 'DL', key: 'day.deloadLabel' }

/**
 * The marks on one run, in render order. A deloaded myo-reps run carries
 * both — they are different axes, so one must not hide the other.
 *
 * `derivedFrom` has five values and only 'deload' surfaces: 'scheme',
 * 'template' and 'override' are how the number was computed, which is the
 * progression sentence's job, and 'autoreg' speaks at week level in its own
 * section rather than whispering on a row.
 */
export function targetMarks(set: DerivedSet): TargetMark[] {
  const marks: TargetMark[] = []
  if (set.derivedFrom === 'deload') marks.push(DELOAD_MARK)
  const technique = set.technique
  if (technique) marks.push(TECHNIQUE_MARK[technique.kind])
  return marks
}

/**
 * One run of identical derived sets, resolved into the CELLS of the day's
 * table rather than a compound string.
 *
 * The string it replaces — "3×5 @ 105 kg · RPE 8 · RIR 2 · 3-1-1 tempo" —
 * was ambiguous by construction: sets-versus-reps ordering is contested
 * enough that gyms publish explainers about it, so `4 × 8` alone reads
 * backwards to a real share of lifters. Under a declared column header no
 * number needs a decoder, ranges and bodyweight loads stop being special
 * cases, and figures line up down their columns where they can be compared.
 *
 * `span` is the escape hatch for metric modes that have no reps and no load:
 * a timed or distance set takes the reps+load columns as one cell rather
 * than inventing two more columns that are empty on every other row.
 */
export interface TargetCells {
  /** Always present — a run is at least one set. */
  sets: string
  marks: TargetMark[]
  reps: string | null
  load: string | null
  /**
   * One autoregulation dialect, never both. RIR and RPE are the same axis
   * inverted, so a row showing "RPE 8 · RIR 2" states one fact twice; the
   * prescription's own choice wins, and RIR is preferred when a row somehow
   * carries both.
   */
  effort: { value: string; kind: 'rir' | 'rpe' } | null
  /** Timed/distance runs: replaces reps AND load. */
  span: string | null
  /** The 4-position code, subordinate to the numbers — rare enough that a
   *  permanent column would be empty on nearly every row. */
  tempo: string | null
}

export function targetCells(
  set: DerivedSet,
  count: number,
  unit: WeightUnit,
  locale: Locale = DEFAULT_LOCALE,
): TargetCells {
  const n = new Intl.NumberFormat(locale)
  const reps = formatReps(set.repMin, set.repMax, locale)
  const timed = set.metricMode !== 'reps_weight'
  const duration =
    set.durationSec !== null ? formatUnitValue(set.durationSec, 'second', locale, true) : null
  const distance = set.distanceM !== null ? formatUnitValue(set.distanceM, 'meter', locale) : null

  return {
    sets: n.format(count),
    marks: targetMarks(set),
    reps: timed ? null : reps,
    load:
      !timed && set.loadKg !== null
        ? formatUnitValue(
            kgToDisplay(set.loadKg, unit),
            unit === 'kg' ? 'kilogram' : 'pound',
            locale,
          )
        : null,
    effort:
      set.rir !== null
        ? { value: n.format(set.rir), kind: 'rir' }
        : set.rpe !== null
          ? { value: n.format(set.rpe), kind: 'rpe' }
          : null,
    span: timed ? [duration, distance].filter((part) => part !== null).join(' / ') || null : null,
    tempo: set.tempo,
  }
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
