import { MAX_WEIGHT } from '@/lib/workout/workout-input'
import type { ParsedSet } from './types'

/**
 * Shared row→set shaping for both parsers: one place decides what counts as
 * a performed set, what's a timed set, and what gets refused — so Strong and
 * Hevy rows can never drift into different semantics.
 */

// Mirrors workout-input.ts' unexported MAX_REPS sanity cap.
const MAX_REPS = 10_000
// sets.duration_sec is a plain integer; cap at 24h — nothing a set does runs longer.
const MAX_DURATION_SEC = 24 * 60 * 60

/** The raw per-row facts a parser extracted, before shaping/validation. */
export interface RawSetFacts {
  /** Parsed reps; null when the cell was blank/unparseable. */
  reps: number | null
  /** Weight already converted to canonical kg; null when blank. */
  weightKg: number | null
  durationSec: number | null
  /** True when the source row is distance work (cardio — a v1 non-goal). */
  hasDistance: boolean
  isWarmup: boolean
}

export type SetBuildResult = { ok: true; set: ParsedSet } | { ok: false; reason: string }

/**
 * Validates and shapes one row into a ParsedSet, or refuses with a reason
 * (the caller records it against the CSV line). Rules, per the PRD:
 * distance rows are skipped (cardio import is out of scope v1); seconds
 * without reps become a 'duration' set; everything else is reps_weight.
 * All imported sets are completed — these apps only log performed work.
 */
export function buildSet(facts: RawSetFacts): SetBuildResult {
  if (facts.hasDistance) {
    return { ok: false, reason: 'distance/cardio set (not imported in v1)' }
  }

  const reps = normalizeInt(facts.reps, MAX_REPS)
  if (reps.invalid) return { ok: false, reason: 'reps out of range' }

  const durationSec = normalizeInt(facts.durationSec, MAX_DURATION_SEC)
  if (durationSec.invalid) return { ok: false, reason: 'duration out of range' }

  let weightKg: number | null = null
  if (facts.weightKg !== null) {
    if (!Number.isFinite(facts.weightKg) || facts.weightKg < 0 || facts.weightKg > MAX_WEIGHT) {
      return { ok: false, reason: 'weight out of range' }
    }
    // Column precision: sets.weight is numeric(6,2).
    weightKg = Math.round(facts.weightKg * 100) / 100
  }

  const isDuration = durationSec.value !== null && durationSec.value > 0 && reps.value === null
  if (reps.value === null && durationSec.value === null && weightKg === null) {
    return { ok: false, reason: 'empty set (no reps, weight, or duration)' }
  }
  // Weight alone is not a performed set — nothing was lifted for any reps.
  if (reps.value === null && !isDuration) {
    return { ok: false, reason: 'set has weight but no reps or duration' }
  }

  return {
    ok: true,
    set: {
      reps: isDuration ? null : reps.value,
      weightKg,
      setType: facts.isWarmup ? 'warmup' : 'working',
      metricMode: isDuration ? 'duration' : 'reps_weight',
      durationSec: isDuration ? durationSec.value : null,
      completed: true,
    },
  }
}

/** Bounds-checks an optional non-negative integer; 0 collapses to null (a
 *  zero cell in these exports means "not recorded", not "zero performed"). */
function normalizeInt(
  value: number | null,
  max: number,
): { value: number | null; invalid: boolean } {
  if (value === null) return { value: null, invalid: false }
  if (!Number.isInteger(value) || value < 0 || value > max) return { value: null, invalid: true }
  return { value: value === 0 ? null : value, invalid: false }
}

/** Parses a numeric cell: '' → null; non-numeric → NaN (callers refuse it).
 *  Accepts "12", "12.5", "12,5" (EU decimal comma). */
export function parseNumericCell(raw: string): number | null {
  if (raw === '') return null
  const normalized = raw.replace(',', '.')
  const value = Number(normalized)
  return Number.isNaN(value) ? Number.NaN : value
}
