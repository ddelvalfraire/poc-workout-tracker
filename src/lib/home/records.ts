import { estimate1RM, effectiveLoadKg } from '@/lib/exercises/one-rep-max'
import { canonicalLiftFor } from '@/lib/goals/trophies'
import type { CanonicalLift } from '@/lib/goals/trophy-kinds'
import type { ExerciseSource } from '@/lib/exercises/custom-exercise-input'
import type { LoggingType } from '@/lib/workout/workout-input'

/**
 * Pure aggregators behind the home record widgets — the half worth testing.
 * The reads that feed them (db/home-records.ts) are one flat query each; all
 * of the judgement lives here, over plain rows.
 */

/** One completed set, flattened, as both queries return it. */
export interface RecordSetRow {
  workoutId: string
  performedAt: Date
  source: ExerciseSource
  wgerExerciseId: number
  exerciseName: string
  loggingType: LoggingType
  reps: number | null
  weight: number | null
  durationSec: number | null
  distanceM: number | null
}

export interface LiftBest {
  e1rmKg: number
  workoutId: string
  performedAt: Date
}

export interface BigThree {
  /** Best e1RM per lift; a lift absent from the map has never been scored. */
  bests: Partial<Record<CanonicalLift, LiftBest>>
  /** Squat + bench + deadlift, or null unless ALL THREE have a best. A
   *  "total" missing a lift is not a smaller total, it is not a total. */
  totalKg: number | null
}

const SUM_LIFTS: readonly CanonicalLift[] = ['squat', 'bench', 'deadlift']

/**
 * Best estimated 1RM per canonical lift, and the three-lift total.
 *
 * Bodyweight-loaded lifts need the user's bodyweight to score at all, so it
 * arrives as a parameter; null simply means those rows do not score, the same
 * rule `bestScoredSet` follows. No rep fallback here on purpose — an
 * estimated total assembled from "most reps" would be a number with no unit,
 * and this widget's whole claim is that it is kilograms.
 */
export function aggregateBigThree(
  rows: readonly RecordSetRow[],
  bodyweightKg: number | null,
): BigThree {
  const bests: Partial<Record<CanonicalLift, LiftBest>> = {}
  for (const row of rows) {
    const lift = canonicalLiftFor(row.source, row.wgerExerciseId, row.exerciseName)
    if (lift === null) continue
    const load = effectiveLoadKg(row.loggingType, row.weight, bodyweightKg)
    const e1rm = estimate1RM(row.reps, load)
    if (e1rm === null) continue
    const current = bests[lift]
    // Strictly greater keeps a tie on the earliest set, matching bestSet and
    // the trophy rules — the record belongs to whoever got there first.
    if (current === undefined || e1rm > current.e1rmKg) {
      bests[lift] = { e1rmKg: e1rm, workoutId: row.workoutId, performedAt: row.performedAt }
    }
  }
  const parts = SUM_LIFTS.map((lift) => bests[lift])
  const totalKg = parts.every((p) => p !== undefined)
    ? parts.reduce((sum, p) => sum + p!.e1rmKg, 0)
    : null
  return { bests, totalKg }
}

export interface CardioRecords {
  /** Lowest seconds per kilometre over sets carrying BOTH duration and
   *  distance. Distance alone is no pace at all. */
  bestPace: { secPerKm: number; workoutId: string; performedAt: Date } | null
  longestDistanceM: { distanceM: number; workoutId: string; performedAt: Date } | null
  longestDurationSec: { durationSec: number; workoutId: string; performedAt: Date } | null
}

/**
 * All-time conditioning records across every exercise, rather than the
 * per-exercise view `getExerciseStats` already gives. Each of the three is
 * independently nullable: a treadmill walk with no distance still sets a
 * duration record, and the tall form of the widget drops the rows it cannot
 * fill instead of inventing them.
 */
export function aggregateCardioRecords(rows: readonly RecordSetRow[]): CardioRecords {
  const out: CardioRecords = { bestPace: null, longestDistanceM: null, longestDurationSec: null }
  for (const row of rows) {
    const { durationSec, distanceM, workoutId, performedAt } = row
    if (durationSec !== null && durationSec > 0) {
      if (out.longestDurationSec === null || durationSec > out.longestDurationSec.durationSec) {
        out.longestDurationSec = { durationSec, workoutId, performedAt }
      }
    }
    if (distanceM !== null && distanceM > 0) {
      if (out.longestDistanceM === null || distanceM > out.longestDistanceM.distanceM) {
        out.longestDistanceM = { distanceM, workoutId, performedAt }
      }
      if (durationSec !== null && durationSec > 0) {
        const secPerKm = durationSec / (distanceM / 1000)
        // LOWER is better for pace — the one record here that is a minimum.
        if (out.bestPace === null || secPerKm < out.bestPace.secPerKm) {
          out.bestPace = { secPerKm, workoutId, performedAt }
        }
      }
    }
  }
  return out
}

export interface DistanceWeek {
  currentM: number
  /** Metres gained or lost against the previous window, or null when that
   *  window was empty — the same no-hollow-comparison rule cardio minutes
   *  follows. */
  deltaM: number | null
}

/** Rolling-window distance totals. Null when the current window is empty, so
 *  the widget renders nothing rather than a standing zero. */
export function aggregateDistanceWeek(currentM: number, previousM: number): DistanceWeek | null {
  if (currentM <= 0) return null
  return { currentM, deltaM: previousM > 0 ? currentM - previousM : null }
}
