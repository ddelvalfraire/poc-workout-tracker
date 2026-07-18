/** Formats a workout's date for display, e.g. "Jun 14, 2026" (server locale). */
export function formatWorkoutDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

import { kgToDisplay, type WeightUnit } from './units'
import type { LoggingType } from './workout-input'

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
 */
export function formatSet(
  reps: number | null,
  weightKg: number | null,
  unit: WeightUnit = 'kg',
  loggingType: LoggingType = 'weight_reps',
): string {
  if (loggingType !== 'weight_reps') {
    const load =
      loggingType === 'bodyweight_reps' || weightKg === null || weightKg === 0
        ? 'BW'
        : `BW${loggingType === 'assisted_bodyweight' ? '−' : '+'}${kgToDisplay(weightKg, unit)}`
    return reps !== null ? `${load} × ${reps}` : load === 'BW' ? '—' : load
  }
  const weight = weightKg !== null ? `${kgToDisplay(weightKg, unit)} ${unit}` : null
  if (reps !== null && weight !== null) return `${reps} × ${weight}`
  if (reps !== null) return `${reps} reps`
  if (weight !== null) return weight
  return '—'
}

/** The set fields the metric-aware formatter reads (matches the `sets` rows). */
export interface LoggedSetLike {
  reps: number | null
  weight: number | null // kg
  metricMode: string // 'reps_weight' | 'duration' | 'duration_distance'
  durationSec: number | null
  distanceM: number | null
}

/** Seconds as a clock: 45 → "0:45", 90 → "1:30", 3900 → "1:05:00". */
function formatClock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.floor(totalSec % 60)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Meters for display: below 1 km in m, at/above in km (trailing zeros trimmed). */
function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`
  const km = meters / 1000
  return `${Number(km.toFixed(2))} km`
}

/**
 * Formats a logged set according to its metric mode — the metric-aware
 * superset of `formatSet`. Timed sets render as a clock ("1:30"), cardio sets
 * as clock + distance ("12:30 · 2.5 km"); unlogged fields drop out and a set
 * with nothing logged renders "—", matching `formatSet`'s contract.
 */
export function formatLoggedSet(
  set: LoggedSetLike,
  unit: WeightUnit = 'kg',
  loggingType: LoggingType = 'weight_reps',
): string {
  if (set.metricMode === 'duration') {
    return set.durationSec !== null ? formatClock(set.durationSec) : '—'
  }
  if (set.metricMode === 'duration_distance') {
    const parts = [
      set.durationSec !== null ? formatClock(set.durationSec) : null,
      set.distanceM !== null ? formatDistance(set.distanceM) : null,
    ].filter((p): p is string => p !== null)
    return parts.length > 0 ? parts.join(' · ') : '—'
  }
  // loggingType lives on the exercise, not the set — the caller passes it down.
  return formatSet(set.reps, set.weight, unit, loggingType)
}

/**
 * Formats a workout's total volume (Σ reps × weight, stored kg) in the active
 * unit, rounded to whole units with digit grouping: 5200.4 → "5,200 kg".
 */
export function formatVolume(volumeKg: number, unit: WeightUnit = 'kg'): string {
  const value = Math.round(kgToDisplay(volumeKg, unit))
  return `${value.toLocaleString('en-US')} ${unit}`
}

const MIN_PLAUSIBLE_DURATION_MS = 60_000 // instant saves carry no signal
const MAX_PLAUSIBLE_DURATION_MS = 6 * 60 * 60_000 // backdated/forgotten sessions

/**
 * A workout's session length as "42 min" / "1 h 5 min", or null when it can't
 * be shown: never completed, or an implausible span (completed at save-time in
 * the same instant, or a backdated startedAt) that would only mislead.
 */
export function formatWorkoutDuration(startedAt: Date, completedAt: Date | null): string | null {
  if (!completedAt) return null
  const ms = completedAt.getTime() - startedAt.getTime()
  if (ms < MIN_PLAUSIBLE_DURATION_MS || ms > MAX_PLAUSIBLE_DURATION_MS) return null
  const totalMin = Math.floor(ms / 60_000) // elapsed time floors: 42:30 is "42 min"
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
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
export function formatE1RM(e1rmKg: number, unit: WeightUnit = 'kg'): string {
  return `${kgToDisplay(e1rmKg, unit)} ${unit}`
}

/**
 * Ghost-input placeholders for set position `index`, from a prior performance
 * (weights converted to the active unit). Returns `{}` when there's no history,
 * no prior set at that index (more sets than last time), or a field was blank
 * last time — so the caller can spread the result onto the inputs and any unset
 * field renders no ghost (an `undefined` `placeholder` is omitted by React).
 */
export function placeholderForSet(
  last: { sets: { reps: number | null; weight: number | null }[] } | null,
  index: number,
  unit: WeightUnit = 'kg',
): { reps?: string; weight?: string } {
  const prior = last?.sets[index]
  if (!prior) return {}
  return {
    reps: prior.reps !== null ? String(prior.reps) : undefined,
    weight: prior.weight !== null ? String(kgToDisplay(prior.weight, unit)) : undefined,
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
 * Compact label for the logger's Previous column: "60×8" (both), "×8" (reps
 * only — null-weight machine sets), "60" (weight only), null when there's
 * nothing to show (the chip renders an em dash, disabled).
 */
export function previousChipLabel(ghost: { reps?: string; weight?: string }): string | null {
  if (ghost.weight && ghost.reps) return `${ghost.weight}×${ghost.reps}`
  if (ghost.reps) return `×${ghost.reps}`
  return ghost.weight ?? null
}

/** Weight-stepper jump per display unit — the smallest common plate added on
 *  BOTH sides (2×1.25 kg / 2×2.5 lb). */
export const WEIGHT_STEP: Record<WeightUnit, number> = { kg: 2.5, lb: 5 }

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
): string | null {
  const base = current.trim() !== '' ? current.trim() : (adoptableGhostValue(ghost) ?? '0')
  if (!/^\d+(\.\d+)?$/.test(base)) return null
  const cents = Math.round(Number(base) * 100) + direction * WEIGHT_STEP[unit] * 100
  return String(Math.max(0, cents) / 100)
}

/** A planned set's ghostable targets, in stored kg (from the program's
 *  engine-derived prescription for the workout's week). */
export interface PlanSetTarget {
  repMin: number | null
  repMax: number | null
  loadKg: number | null
  /** Prescribed rest AFTER this set, seconds — feeds the logger's rest
   *  countdown (resolveRestTarget), not the ghost placeholders. */
  restSec: number | null
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
): { reps?: string; weight?: string } {
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
    weight: target.loadKg !== null ? String(kgToDisplay(target.loadKg, unit)) : undefined,
  }
}
