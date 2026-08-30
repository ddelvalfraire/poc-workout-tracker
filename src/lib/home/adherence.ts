import { estimate1RM, effectiveLoadKg } from '@/lib/exercises/one-rep-max'
import { canonicalLiftFor } from '@/lib/goals/trophies'
import type { CanonicalLift } from '@/lib/goals/trophy-kinds'
import type { RecordSetRow } from './records'

/**
 * Two derivations that did not exist before this change: how well training
 * held up across a diet phase, and how closely logged sets matched what was
 * prescribed. Both are pure — the reads (db/home-adherence.ts) fetch flat
 * rows and every judgement lives here.
 */

export interface LiftRetention {
  beforeKg: number
  sinceKg: number
  /** sinceKg / beforeKg as a percentage, rounded. Can exceed 100 — gaining
   *  during a cut is rare but real, and clamping it would hide the best news
   *  the widget could ever carry. */
  percent: number
}

export interface StrengthRetention {
  /** Only lifts with a scored best on BOTH sides of the anchor. A lift first
   *  trained mid-cut has nothing to be compared against. */
  lifts: Partial<Record<CanonicalLift, LiftRetention>>
  /** Load-weighted across those lifts: total kg held / total kg before.
   *  Weighted rather than a mean of percentages, so a 200 kg deadlift is not
   *  outvoted by a 40 kg overhead press. */
  percent: number
}

interface Bests {
  before: Partial<Record<CanonicalLift, number>>
  since: Partial<Record<CanonicalLift, number>>
}

/**
 * Best e1RM per lift on each side of `anchor`, then the ratio.
 *
 * The anchor is the instant a diet phase was set. Sets performed exactly AT
 * it count as after: the phase began then, so the work belongs to it.
 *
 * Returns null when no lift has a best on both sides — with nothing to
 * compare, the widget renders nothing rather than a hopeful 100%.
 */
export function aggregateStrengthRetention(
  rows: readonly RecordSetRow[],
  anchor: Date,
  bodyweightKg: number | null,
): StrengthRetention | null {
  const bests: Bests = { before: {}, since: {} }
  for (const row of rows) {
    const lift = canonicalLiftFor(row.source, row.wgerExerciseId, row.exerciseName)
    if (lift === null) continue
    const e1rm = estimate1RM(row.reps, effectiveLoadKg(row.loggingType, row.weight, bodyweightKg))
    if (e1rm === null) continue
    const side = row.performedAt.getTime() < anchor.getTime() ? bests.before : bests.since
    const current = side[lift]
    if (current === undefined || e1rm > current) side[lift] = e1rm
  }

  const lifts: StrengthRetention['lifts'] = {}
  let beforeTotal = 0
  let sinceTotal = 0
  for (const lift of Object.keys(bests.before) as CanonicalLift[]) {
    const beforeKg = bests.before[lift]!
    const sinceKg = bests.since[lift]
    if (sinceKg === undefined || beforeKg <= 0) continue
    lifts[lift] = {
      beforeKg,
      sinceKg,
      percent: Math.round((sinceKg / beforeKg) * 100),
    }
    beforeTotal += beforeKg
    sinceTotal += sinceKg
  }
  if (beforeTotal <= 0) return null
  return { lifts, percent: Math.round((sinceTotal / beforeTotal) * 100) }
}

/** One completed set that carried a prescription. */
export interface PrescribedSetRow {
  prescribedLoadKg: number | null
  prescribedRepMin: number | null
  weight: number | null
  reps: number | null
}

export interface PlanAdherence {
  hit: number
  total: number
}

/** Floating-point slack, in kg. Prescribed loads are stored to 2 decimals and
 *  actuals are user-entered, so an exact >= would fail on 62.5 vs 62.499999. */
const LOAD_EPSILON = 0.001

/**
 * How many prescribed sets were met. A set counts as met when it reached BOTH
 * targets it was given — the prescribed load and the prescribed rep floor.
 * A set prescribed only one of the two is judged only on that one.
 *
 * Overshooting counts as met, obviously: the prescription is a floor, not a
 * ceiling, and someone who beat every target has not failed adherence.
 *
 * Sets carrying no prescription at all are not counted in either direction —
 * they are not evidence about a plan nobody made.
 *
 * Returns null when the window holds no prescribed sets, so the widget stays
 * silent for anyone training without a program.
 */
export function aggregatePlanAdherence(rows: readonly PrescribedSetRow[]): PlanAdherence | null {
  let hit = 0
  let total = 0
  for (const row of rows) {
    const hasLoad = row.prescribedLoadKg !== null
    const hasReps = row.prescribedRepMin !== null
    if (!hasLoad && !hasReps) continue
    total++
    const loadMet = !hasLoad || (row.weight ?? 0) + LOAD_EPSILON >= row.prescribedLoadKg!
    const repsMet = !hasReps || (row.reps ?? 0) >= row.prescribedRepMin!
    if (loadMet && repsMet) hit++
  }
  return total === 0 ? null : { hit, total }
}
