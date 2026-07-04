/** Formats a workout's date for display, e.g. "Jun 14, 2026" (server locale). */
export function formatWorkoutDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

import { kgToDisplay, type WeightUnit } from './units'

/**
 * Formats a logged set's reps/weight for display. Weight is stored in kg and
 * converted to the caller's `unit` (default kg). `null` means the field was
 * left blank when logging.
 *   (5, 100) → "5 × 100 kg"           (5, null) → "5 reps"
 *   (5, 100, 'lb') → "5 × 220.5 lb"   (null, null) → "—"
 */
export function formatSet(
  reps: number | null,
  weightKg: number | null,
  unit: WeightUnit = 'kg',
): string {
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
export function formatLoggedSet(set: LoggedSetLike, unit: WeightUnit = 'kg'): string {
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
  return formatSet(set.reps, set.weight, unit)
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

/** A planned set's ghostable targets, in stored kg (from the program's
 *  engine-derived prescription for the workout's week). */
export interface PlanSetTarget {
  repMin: number | null
  repMax: number | null
  loadKg: number | null
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
