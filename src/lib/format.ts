import { kgToDisplay, type WeightUnit } from './units'
import { quantizeDisplayLoad } from './load-quantize'
import { formatDistanceInput, formatDurationInput } from './duration'
import type { LoggingType } from './workout-input'
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config'
import type { Message } from './message'

/**
 * Dates, numbers and units are NOT catalog entries — they are `Intl`.
 * "Jun 14, 2026" is not a string to translate, and a hardcoded 'en-US' here
 * is a localization bug rather than a missing message. Every formatter below
 * therefore takes the resolved `locale` (defaulted, so the modules that only
 * ever render in the default locale keep their call sites) and hands the
 * numerals to Intl.
 *
 * Only the surrounding WORDS — "reps", "BW", "set", "min" — leave as message
 * DESCRIPTORS (`{ key, values }`, see ./message.ts) for the caller to render
 * with `t(msg.key, msg.values)`. Weights, volumes and distances need no
 * catalog entry at all: `Intl.NumberFormat`'s unit style already carries
 * "kg"/"lb"/"m"/"km" with the locale's own grouping and separators.
 */

/** Formats a workout's date for display, e.g. "Jun 14, 2026" in `en`. */
export function formatWorkoutDate(date: Date, locale: Locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

/** Our weight units as CLDR unit identifiers, for Intl's `style: 'unit'`. */
const INTL_WEIGHT_UNIT: Record<WeightUnit, string> = { kg: 'kilogram', lb: 'pound' }

/**
 * A display-unit weight with its unit word — "100 kg", "220.5 lb" — from
 * Intl, so the decimal separator and the unit label follow the locale
 * instead of being concatenated by hand.
 *
 * Ungrouped by default: a single lift's load reads as one number ("1003.1
 * lb"), and only a session TOTAL is large enough to want thousands
 * separators — `formatVolume` opts in.
 */
function formatWeight(
  valueInDisplayUnit: number,
  unit: WeightUnit,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: INTL_WEIGHT_UNIT[unit],
    unitDisplay: 'short',
    useGrouping: false,
    ...options,
  }).format(valueInDisplayUnit)
}

/** Ghost-placeholder strings for one set's inputs — reps/weight for lifting
 *  rows, duration (mm:ss) / distance (km) for cardio rows. Every field is
 *  optional; an unset field renders no ghost. */
export interface SetGhost {
  reps?: string
  weight?: string
  duration?: string
  distance?: string
}

/**
 * Formats a logged set's reps/weight for display. Weight is stored in kg and
 * converted to the caller's `unit` (default kg). `null` means the field was
 * left blank when logging.
 *   (5, 100) → "5 × 100 kg"           (5, null) → "5 reps"
 *   (5, 100, 'lb') → "5 × 220.5 lb"   (null, null) → "—"
 *
 * `loggingType` (default 'weight_reps', so every existing call site keeps its
 * output) re-reads the weight for bodyweight exercises, load-first:
 *   bodyweight_reps      → "BW × 12"
 *   weighted_bodyweight  → "BW+25 × 8"   (added load, display unit)
 *   assisted_bodyweight  → "BW−20 × 6"   (assistance, display unit)
 * A blank added/assist weight renders plain "BW × n"; a set with no reps at
 * all falls back to "—", matching the weight_reps contract.
 *
 * Returns a DESCRIPTOR, not a sentence: "reps" and "BW" are words, so the
 * branch is decided here and the wording lives in the `Format` namespace.
 * The weight itself is already Intl-formatted into `values.weight`, because
 * "220.5 lb" is a number, not copy.
 */
export type SetMessageKey =
  | 'empty'
  | 'set'
  | 'setReps'
  | 'setWeight'
  | 'setBodyweight'
  | 'setBodyweightReps'

/** Which side of bodyweight the stored weight sits on — the `kind` select
 *  arm the bodyweight messages branch on. */
type BodyweightKind = 'plain' | 'added' | 'assisted'

export function formatSet(
  reps: number | null,
  weightKg: number | null,
  unit: WeightUnit = 'kg',
  loggingType: LoggingType = 'weight_reps',
  locale: Locale = DEFAULT_LOCALE,
): Message<SetMessageKey> {
  if (loggingType !== 'weight_reps') {
    const bare = loggingType === 'bodyweight_reps' || weightKg === null || weightKg === 0
    const kind: BodyweightKind = bare
      ? 'plain'
      : loggingType === 'assisted_bodyweight'
        ? 'assisted'
        : 'added'
    // The added/assist amount is a bare number, not a weight-with-unit: the
    // "BW+25" idiom carries the unit implicitly from the account setting.
    const load = bare ? 0 : kgToDisplay(weightKg as number, unit)
    if (reps !== null) return { key: 'setBodyweightReps', values: { kind, load, reps } }
    return bare ? { key: 'empty' } : { key: 'setBodyweight', values: { kind, load } }
  }
  const weight = weightKg !== null ? formatWeight(kgToDisplay(weightKg, unit), unit, locale) : null
  if (reps !== null && weight !== null) return { key: 'set', values: { reps, weight } }
  if (reps !== null) return { key: 'setReps', values: { reps } }
  if (weight !== null) return { key: 'setWeight', values: { weight } }
  return { key: 'empty' }
}

/** The set fields the metric-aware formatter reads (matches the `sets` rows). */
export interface LoggedSetLike {
  reps: number | null
  weight: number | null // kg
  metricMode: string // 'reps_weight' | 'duration' | 'duration_distance'
  durationSec: number | null
  distanceM: number | null
}

/** Seconds as a clock: 45 → "0:45", 90 → "1:30", 3900 → "1:05:00".
 *  Deliberately NOT `Intl.DurationFormat`: its digital style zero-pads the
 *  leading field ("01:30"), which is a different display contract from the
 *  one the logger, the rest pill and the share cards all render. A colon
 *  clock carries no words, so there is nothing here to translate. */
function formatClock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.floor(totalSec % 60)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Meters for display: below 1 km in m, at/above in km (trailing zeros
 *  trimmed). The unit word comes from Intl, not from the catalog — "m"/"km"
 *  are CLDR unit labels that differ per locale on their own. */
function formatDistance(meters: number, locale: Locale): string {
  const inKm = meters >= 1000
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: inKm ? 'kilometer' : 'meter',
    unitDisplay: 'short',
    maximumFractionDigits: inKm ? 2 : 0,
  }).format(inKm ? meters / 1000 : meters)
}

/**
 * Formats a logged set according to its metric mode — the metric-aware
 * superset of `formatSet`. Timed sets render as a clock ("1:30"), cardio sets
 * as clock + distance ("12:30 · 2.5 km"); unlogged fields drop out and a set
 * with nothing logged renders "—", matching `formatSet`'s contract.
 */
export type LoggedSetMessageKey = SetMessageKey | 'setDuration' | 'setDurationDistance'

export function formatLoggedSet(
  set: LoggedSetLike,
  unit: WeightUnit = 'kg',
  loggingType: LoggingType = 'weight_reps',
  locale: Locale = DEFAULT_LOCALE,
): Message<LoggedSetMessageKey> {
  if (set.metricMode === 'duration') {
    return set.durationSec !== null
      ? { key: 'setDuration', values: { duration: formatClock(set.durationSec) } }
      : { key: 'empty' }
  }
  if (set.metricMode === 'duration_distance') {
    const duration = set.durationSec !== null ? formatClock(set.durationSec) : null
    const distance = set.distanceM !== null ? formatDistance(set.distanceM, locale) : null
    if (duration !== null && distance !== null) {
      return { key: 'setDurationDistance', values: { duration, distance } }
    }
    if (duration !== null) return { key: 'setDuration', values: { duration } }
    // A distance with no clock rides the same one-value slot as a bare
    // duration — one message, one argument, whichever metric was logged.
    if (distance !== null) return { key: 'setDuration', values: { duration: distance } }
    return { key: 'empty' }
  }
  // loggingType lives on the exercise, not the set — the caller passes it down.
  return formatSet(set.reps, set.weight, unit, loggingType, locale)
}

/**
 * Formats a workout's total volume (Σ reps × weight, stored kg) in the active
 * unit, rounded to whole units with digit grouping: 5200.4 → "5,200 kg".
 */
export function formatVolume(
  volumeKg: number,
  unit: WeightUnit = 'kg',
  locale: Locale = DEFAULT_LOCALE,
): string {
  return formatWeight(Math.round(kgToDisplay(volumeKg, unit)), unit, locale, {
    useGrouping: true,
  })
}

/**
 * The same volume, split into its numeral and its unit label — for the two
 * call sites that set them at different type scales. Split by Intl's own
 * `formatToParts` rather than `formatVolume(...).split(' ')`: several locales
 * group with a narrow no-break space, which a plain space split would tear
 * the number in half on.
 */
export function formatVolumeParts(
  volumeKg: number,
  unit: WeightUnit = 'kg',
  locale: Locale = DEFAULT_LOCALE,
): { value: string; unit: string } {
  const parts = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: INTL_WEIGHT_UNIT[unit],
    unitDisplay: 'short',
    useGrouping: true,
  }).formatToParts(Math.round(kgToDisplay(volumeKg, unit)))
  return {
    value: parts
      .filter((p) => p.type !== 'unit')
      .map((p) => p.value)
      .join('')
      .trim(),
    unit: parts
      .filter((p) => p.type === 'unit')
      .map((p) => p.value)
      .join(''),
  }
}

const MIN_PLAUSIBLE_DURATION_MS = 60_000 // instant saves carry no signal
const MAX_PLAUSIBLE_DURATION_MS = 6 * 60 * 60_000 // backdated/forgotten sessions

/**
 * A workout's session length in whole minutes (elapsed time floors: 42:30 is
 * 42), or null when it can't be shown: never completed, or an implausible
 * span (completed at save-time in the same instant, or a backdated startedAt)
 * that would only mislead. The comparable form behind `formatWorkoutDuration`
 * — delta computations (summary "vs last" sub-lines) subtract these.
 */
export function workoutDurationMinutes(startedAt: Date, completedAt: Date | null): number | null {
  if (!completedAt) return null
  const ms = completedAt.getTime() - startedAt.getTime()
  if (ms < MIN_PLAUSIBLE_DURATION_MS || ms > MAX_PLAUSIBLE_DURATION_MS) return null
  return Math.floor(ms / 60_000)
}

/**
 * A workout's session length as "42 min" / "1 h 5 min", or null under the
 * same plausibility rules as `workoutDurationMinutes`.
 *
 * A descriptor rather than a string: "h" and "min" are the unit WORDS this
 * app abbreviates its own way (Intl's short hour label is "hr"), so they are
 * catalog entries — while the numbers inside them are rendered by ICU, and
 * therefore by Intl, at the caller.
 */
export function formatWorkoutDuration(
  startedAt: Date,
  completedAt: Date | null,
): Message<'duration' | 'durationHours'> | null {
  const totalMin = workoutDurationMinutes(startedAt, completedAt)
  if (totalMin === null) return null
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  return hours > 0
    ? { key: 'durationHours', values: { hours, minutes } }
    : { key: 'duration', values: { minutes } }
}

/**
 * A live session's elapsed time as "12:05" / "1:02:07" (seconds always padded,
 * minutes padded only under an hour prefix), or null when it would mislead:
 * negative (clock skew) or past the same 6 h plausibility ceiling as
 * formatWorkoutDuration — an edit of a backdated session isn't a live clock.
 */
export function formatElapsed(ms: number): string | null {
  if (ms < 0 || ms > MAX_PLAUSIBLE_DURATION_MS) return null
  const totalSec = Math.floor(ms / 1_000)
  const h = Math.floor(totalSec / 3_600)
  const m = Math.floor((totalSec % 3_600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * Formats an estimated 1RM (stored-kg) for display in the active unit, e.g.
 *   117 (kg) → "117 kg"      117 (lb) → "258 lb"
 * Rounds via kgToDisplay (kg identity, lb to 1dp), matching formatSet.
 */
export function formatE1RM(
  e1rmKg: number,
  unit: WeightUnit = 'kg',
  locale: Locale = DEFAULT_LOCALE,
): string {
  return formatWeight(kgToDisplay(e1rmKg, unit), unit, locale)
}

/**
 * Ghost-input placeholders for set position `index`, from a prior performance
 * (weights converted to the active unit). Returns `{}` when there's no history,
 * no prior set at that index (more sets than last time), or a field was blank
 * last time — so the caller can spread the result onto the inputs and any unset
 * field renders no ghost (an `undefined` `placeholder` is omitted by React).
 */
export function placeholderForSet(
  last: {
    sets: {
      reps: number | null
      weight: number | null
      /** Cardio ride-alongs (LastPerformance) — optional so pre-cardio
       *  fixtures and callers keep their shape. */
      durationSec?: number | null
      distanceM?: number | null
    }[]
  } | null,
  index: number,
  unit: WeightUnit = 'kg',
): SetGhost {
  const prior = last?.sets[index]
  if (!prior) return {}
  return {
    reps: prior.reps !== null ? String(prior.reps) : undefined,
    weight: prior.weight !== null ? String(kgToDisplay(prior.weight, unit)) : undefined,
    // Ghosts speak the INPUT dialect (mm:ss / km — lib/duration.ts), so a
    // tap-to-adopt lands a value the field would accept as typed.
    duration: prior.durationSec != null ? formatDurationInput(prior.durationSec) : undefined,
    distance: prior.distanceM != null ? formatDistanceInput(prior.distanceM) : undefined,
  }
}

/**
 * The input value a ghost placeholder can be adopted as (tap-to-accept in the
 * logger). Plain numerics adopt verbatim; a rep-range ghost like "8–12"
 * adopts its FLOOR (the plan minimum) — dropping it entirely left one-tap
 * completion recording a weight with no reps. Anything else is display-only.
 */
export function adoptableGhostValue(ghost?: string): string | undefined {
  if (!ghost) return undefined
  if (/^\d+(\.\d+)?$/.test(ghost)) return ghost
  const range = ghost.match(/^(\d+)–\d+$/)
  return range ? range[1] : undefined
}

/**
 * The set row's grey input ghost: the PLAN's week-N target, nothing else.
 * History lives in the Prev column — ghosting it in the inputs too put the
 * same numbers on screen twice with different meanings (and partial history
 * produced mixed-source fragments). A plan target may be legitimately
 * partial (a rep range without a prescribed load is a real prescription);
 * BW-relative types never ghost a weight — theirs isn't a total load.
 */
export function planSetGhost(plan: SetGhost, loggingType: LoggingType): SetGhost {
  return {
    reps: plan.reps,
    weight: loggingType === 'weight_reps' ? plan.weight : undefined,
    // Cardio targets pass through untouched: duration/distance have no
    // BW-relative reading, so the loggingType strip never applies to them.
    duration: plan.duration,
    distance: plan.distance,
  }
}

/**
 * Compact label for the logger's Previous column: "60×8", or null when there's
 * nothing to show (the chip renders an em dash, disabled).
 *
 * weight_reps (the default) requires BOTH fields — a null-weight history set
 * would otherwise render fragments like "×10" that read as broken data, not
 * history. Bodyweight types keep reps-only labels ("×8"): their weight ghost
 * is stripped by design, so reps ARE the complete story.
 */
export function previousChipLabel(
  ghost: SetGhost,
  loggingType: LoggingType = 'weight_reps',
): string | null {
  // Cardio history: the duration IS the story (the chip is one word wide —
  // distance rides the fill, not the label).
  if (ghost.duration) return ghost.duration
  if (ghost.weight && ghost.reps) return `${ghost.weight}×${ghost.reps}`
  if (loggingType === 'weight_reps') return null
  if (ghost.reps) return `×${ghost.reps}`
  return ghost.weight ?? null
}

/**
 * One-line summary for a collapsed, fully-completed logger card:
 * "4 sets · top 100×8", or "3 sets · top ×12" when no set carries a weight
 * (BW / null-weight machines — the highest rep count stands in for "top").
 *
 * `weight`'s meaning varies by logging type, so "top" must too: total load
 * (weight_reps, max wins, bare number), added load (weighted_bodyweight, max
 * wins, "BW+45×5"), or assistance (assisted_bodyweight, MIN wins — less help
 * is the harder set — "BW−20×8"). bodyweight_reps is reps-only by definition.
 */
export function completedSetsSummary(
  sets: readonly { reps: string; weight: string }[],
  loggingType: LoggingType,
): Message<'summary' | 'summaryTop' | 'summaryTopLoad' | 'summaryTopReps'> {
  const count = sets.length
  let top: { weight: number; reps: string } | null = null
  let topReps = 0
  for (const set of sets) {
    const weight = Number.parseFloat(set.weight)
    if (loggingType !== 'bodyweight_reps' && Number.isFinite(weight)) {
      const beats =
        top === null ||
        (loggingType === 'assisted_bodyweight' ? weight < top.weight : weight > top.weight)
      if (beats) top = { weight, reps: set.reps }
    }
    const reps = Number.parseInt(set.reps, 10)
    if (Number.isFinite(reps) && reps > topReps) topReps = reps
  }
  if (top) {
    const kind: BodyweightKind =
      loggingType === 'weighted_bodyweight'
        ? 'added'
        : loggingType === 'assisted_bodyweight'
          ? 'assisted'
          : 'plain'
    const values = { count, kind, load: top.weight, reps: top.reps }
    return top.reps ? { key: 'summaryTop', values } : { key: 'summaryTopLoad', values }
  }
  if (topReps > 0) return { key: 'summaryTopReps', values: { count, reps: topReps } }
  return { key: 'summary', values: { count } }
}

/** Weight-stepper jump per display unit — the smallest common plate added on
 *  BOTH sides (2×1.25 kg / 2×2.5 lb). */
export const WEIGHT_STEP: Record<WeightUnit, number> = { kg: 2.5, lb: 5 }

/** What the settings picker offers, unit-native. The defaults above are the
 *  middle of each list: the smallest plate pair most gyms have (2.5 kg / 5 lb).
 *  Smaller suits microloading and machines; larger suits a lifter who only
 *  ever jumps in whole plates. */
export const WEIGHT_STEP_CHOICES: Record<WeightUnit, readonly number[]> = {
  kg: [0.5, 1, 1.25, 2.5, 5],
  lb: [1, 2.5, 5, 10],
}

/** The step to actually use: the user's stored preference when it is one this
 *  unit offers, the unit default otherwise. Guards stored data the way
 *  getDefaultRestSec does — a row written under the other unit, or corrupted,
 *  degrades to the default rather than stepping by something nonsensical.
 *  The preference is stored unit-native and NOT converted on a unit switch,
 *  so this is also what makes a kg step stop applying to lb. */
export function resolveWeightStep(stored: number | null | undefined, unit: WeightUnit): number {
  return stored != null && WEIGHT_STEP_CHOICES[unit].includes(stored) ? stored : WEIGHT_STEP[unit]
}

/**
 * Next weight-input value for a ± stepper tap. A typed value steps in place;
 * an empty field adopts the ghost first and steps from there (tapping + on an
 * untouched set means "more than last time"); no ghost steps from zero.
 * Integer-cents math so 2.5 jumps never accumulate float drift; floors at 0.
 * Null when the field holds something non-numeric — the stepper no-ops rather
 * than clobbering text the lifter typed.
 */
export function stepWeightValue(
  current: string,
  ghost: string | undefined,
  direction: 1 | -1,
  unit: WeightUnit,
  /** The user's step, already resolved. Defaults to the unit's own so every
   *  existing caller and test keeps its exact behaviour. */
  step: number = WEIGHT_STEP[unit],
): string | null {
  const base = current.trim() !== '' ? current.trim() : (adoptableGhostValue(ghost) ?? '0')
  if (!/^\d+(\.\d+)?$/.test(base)) return null
  const cents = Math.round(Number(base) * 100) + direction * step * 100
  return String(Math.max(0, cents) / 100)
}

/** A planned set's ghostable targets, in stored kg (from the program's
 *  engine-derived prescription for the workout's week). */
export interface PlanSetTarget {
  repMin: number | null
  repMax: number | null
  loadKg: number | null
  /** Prescribed effort target (program_sets.rir/rpe through the week
   *  derivation) — the structural arm of the effort-row show rule. Optional:
   *  pre-effort call sites and fixtures carry neither. */
  rir?: number | null
  rpe?: number | null
  /** The unadjusted scheme load when autoreg touched this set — the value the
   *  logger's "Use plan as written" escape reverts to. Absent otherwise. */
  planLoadKg?: number | null
  /** Prescribed rest AFTER this set, seconds — feeds the logger's rest
   *  countdown (resolveRestTarget), not the ghost placeholders. */
  restSec: number | null
  /** Cardio targets (duration/duration_distance sets) — optional so
   *  pre-cardio call sites and fixtures keep their shape. */
  durationSec?: number | null
  distanceM?: number | null
}

/**
 * Ghost-input placeholders for set position `index` from the day's PLAN — the
 * fallback when there's no prior performance to ghost from (e.g. a machine
 * lift's first session). Rep ranges render as "8–12" (placeholders are display
 * text, not values, so a number input accepts the en dash). Same `{}` /
 * `undefined` contract as `placeholderForSet`.
 */
export function planPlaceholderForSet(
  targets: readonly PlanSetTarget[] | undefined,
  index: number,
  unit: WeightUnit = 'kg',
): SetGhost {
  const target = targets?.[index]
  if (!target) return {}
  let reps: string | undefined
  if (target.repMin !== null && target.repMax !== null) {
    reps = target.repMin === target.repMax ? String(target.repMin) : `${target.repMin}–${target.repMax}`
  } else {
    const single = target.repMin ?? target.repMax
    reps = single !== null ? String(single) : undefined
  }
  return {
    reps,
    // Quantized display (#226): plan-target ghosts must be loadable numbers.
    // New derivations are already on the grid; this also cleans the ghosts of
    // legacy prescribed snapshots stamped before quantization existed.
    weight: target.loadKg !== null ? String(quantizeDisplayLoad(target.loadKg, unit)) : undefined,
    // Cardio plan targets ghost in the input dialect (mm:ss / km), same as
    // the history placeholders — adoption must land typed-valid values.
    duration: target.durationSec != null ? formatDurationInput(target.durationSec) : undefined,
    distance: target.distanceM != null ? formatDistanceInput(target.distanceM) : undefined,
  }
}
