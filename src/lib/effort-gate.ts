import type { AutoregAdjustment, AutoregSession } from './autoregulate'
import type { WeightUnit } from './units'
// ε-or-increment identity so a pre-quantization snapshot still matches its
// quantized re-derivation (#226 transitional bridge).
import { LOAD_EPSILON_KG, loadsMatch } from './load-quantize'
import { estimate1RM } from './one-rep-max'

/**
 * The EFFORT GATE (RPE plan slice 3) — a pure post-hoc layer over the rep
 * rules' verdict, shaped exactly like applyDietPhaseToAdjustment: additive
 * fields, never a rewrite of the base verdict's evidence, and `===`
 * passthrough whenever it doesn't apply — byte-identity for lifters who
 * never touch the effort chips.
 *
 * Two conservative rules only (holds, never new load changes):
 * - OVERSHOOT-HOLD: reps hit but the newest top set ran a FULL RPE point
 *   hotter than prescribed → hold the load instead of stepping. Fixed mode
 *   synthesizes the hold (a null verdict there means "let the scheme
 *   increment"); range mode downgrades its 'step'. +1 is the threshold
 *   because reported RPE is only accurate to about a point (Halperin 2022)
 *   — reacting to half points is reacting to noise.
 * - TREND VETO: H2's third-stall decrement is vetoed when the credited
 *   e1RM trend across the window is RISING — a missed-rep day on a rising
 *   trend is a bad day, not a stall. The advisory early-deload flag
 *   survives the veto (resolved decision: the veto protects loads, not
 *   information).
 *
 * Composition order is law: the diet-phase gate runs FIRST and a cutting
 * hold is never reopened here. Anchor / deload-flag modes pass through —
 * those schemes own their loads and self-correct (rpe-target through the
 * rolling e1RM, slice 1).
 */

/** Sessions with a logged-effort top set required before the gate acts at
 *  all — matches the engine's stall cadence; the 4-session history window
 *  makes a larger floor unsatisfiable. */
export const EFFORT_GATE_MIN_SESSIONS = 3

/** Full-point overshoot before a hold (reporting noise is ~±1, Halperin 2022). */
export const OVERSHOOT_RPE_THRESHOLD = 1

/** A trend must gain at least this much credited e1RM to count as rising. */
const TREND_MIN_GAIN_KG = 0.5

/** RIR above this = too far from failure for a credible e1RM (same guard
 *  as lib/rolling-e1rm.ts). */
const MAX_CREDIBLE_RIR = 3

type AutoregMode = 'fixed' | 'range' | 'anchor' | 'deload-flag'

interface TopPair {
  prescribed: AutoregSession['prescribed'][number]
  actual: AutoregSession['actual'][number]
}

/** The session's governing pair: the highest prescribed-load non-warmup set,
 *  matched to its completed actual by setNumber (valid WITHIN one session).
 *  Null when nothing is scorable — silence over corruption. */
function topPair(session: AutoregSession): TopPair | null {
  let top: AutoregSession['prescribed'][number] | null = null
  for (const p of session.prescribed) {
    if (p.setType === 'warmup' || p.loadKg === null) continue
    if (top === null || p.loadKg > (top.loadKg as number)) top = p
  }
  if (top === null) return null
  const topSetNumber = top.setNumber
  const actual = session.actual.find((a) => a.setNumber === topSetNumber)
  if (actual === undefined || !actual.completed || actual.setType === 'warmup') return null
  return { prescribed: top, actual }
}

/** One RPE number from whichever scale is present (RPE wins; RIR converts
 *  as 10 − rir — the chips' own anchoring). Null = no effort statement. */
function effortAsRpe(rpe: number | null | undefined, rir: number | null | undefined): number | null {
  if (rpe !== null && rpe !== undefined) return rpe
  if (rir !== null && rir !== undefined) return 10 - rir
  return null
}

/** Credited top-set e1RM for the trend (Epley on reps + rir, same rules as
 *  the rolling signal); null disqualifies the session from trend evidence. */
function creditedTopE1rm(session: AutoregSession): number | null {
  const pair = topPair(session)
  if (pair === null) return null
  const rir = pair.actual.rir ?? null
  if (rir !== null && rir > MAX_CREDIBLE_RIR) return null
  if (pair.actual.reps === null) return null
  return estimate1RM(pair.actual.reps + (rir ?? 0), pair.actual.weightKg)
}

/** Rising = monotonically non-decreasing oldest→newest with a real net gain.
 *  Any unscorable session breaks the chain — a trend with holes is no trend. */
function risingTrend(orderedDesc: AutoregSession[]): boolean {
  const series = [...orderedDesc].reverse().map(creditedTopE1rm)
  if (series.length < EFFORT_GATE_MIN_SESSIONS || series.some((v) => v === null)) return false
  const points = series as number[]
  for (let i = 1; i < points.length; i++) {
    if (points[i] < points[i - 1]) return false
  }
  return points[points.length - 1] - points[0] > TREND_MIN_GAIN_KG
}

/**
 * SUSTAINED UNDERSHOOT (RPE plan slice 4's detector): the newest TWO
 * sessions (mirror of M2's two-session confirm) both worked the same
 * ε-comparable top load with floors met and logged effort a FULL point or
 * more UNDER the prescribed target. Returns the load that earned a step —
 * consumed by the proposal trigger (db/reactive-deload.ts), never applied
 * automatically: steps are the owner's confirm, holds are the only thing
 * the gate does on its own. Same activation floor as the gate.
 */
export function sustainedUndershoot(
  sessions: AutoregSession[],
  unit?: WeightUnit,
): { loadKg: number } | null {
  const ordered = [...sessions].sort((a, b) => b.startedAtMs - a.startedAtMs) // H6
  const loggedCount = ordered.filter((s) => {
    const pair = topPair(s)
    return pair !== null && effortAsRpe(pair.actual.rpe, pair.actual.rir) !== null
  }).length
  if (loggedCount < EFFORT_GATE_MIN_SESSIONS) return null

  let caseLoadKg: number | null = null
  for (const s of ordered.slice(0, 2)) {
    const pair = topPair(s)
    if (pair === null || pair.prescribed.loadKg === null) return null
    const target = effortAsRpe(pair.prescribed.rpe, pair.prescribed.rir)
    const logged = effortAsRpe(pair.actual.rpe, pair.actual.rir)
    if (target === null || logged === null) return null
    const floorMet =
      pair.prescribed.repMin === null ||
      (pair.actual.reps !== null && pair.actual.reps >= pair.prescribed.repMin)
    if (!floorMet) return null // easy AND failed cannot coexist honestly
    if (logged > target - OVERSHOOT_RPE_THRESHOLD) return null
    if (caseLoadKg === null) caseLoadKg = pair.prescribed.loadKg
    else if (!loadsMatch(pair.prescribed.loadKg, caseLoadKg, LOAD_EPSILON_KG, unit)) return null
  }
  return caseLoadKg === null ? null : { loadKg: caseLoadKg }
}

export function applyEffortToAdjustment(
  adjustment: AutoregAdjustment | null,
  sessions: AutoregSession[],
  mode: AutoregMode,
): AutoregAdjustment | null {
  // Anchor / deload-flag schemes own their loads; a cutting hold is sacred.
  if (mode === 'anchor' || mode === 'deload-flag') return adjustment
  if (adjustment?.phaseContext === 'cutting') return adjustment

  const ordered = [...sessions].sort((a, b) => b.startedAtMs - a.startedAtMs) // H6
  const loggedCount = ordered.filter((s) => {
    const pair = topPair(s)
    return pair !== null && effortAsRpe(pair.actual.rpe, pair.actual.rir) !== null
  }).length
  if (loggedCount < EFFORT_GATE_MIN_SESSIONS) return adjustment

  // TREND VETO — only H2's load-touching decrement, only in fixed mode.
  if (adjustment !== null && adjustment.action === 'decrement' && mode === 'fixed') {
    if (!risingTrend(ordered)) return adjustment
    return { ...adjustment, action: 'repeat', deltaKg: 0, effortContext: 'trend-veto' }
  }

  // OVERSHOOT-HOLD — newest session's governing pair, floor met, a full
  // point hot against a PRESCRIBED effort target (no target, no opinion).
  const newest = ordered[0]
  if (newest === undefined) return adjustment
  const pair = topPair(newest)
  if (pair === null) return adjustment
  const target = effortAsRpe(pair.prescribed.rpe, pair.prescribed.rir)
  const logged = effortAsRpe(pair.actual.rpe, pair.actual.rir)
  if (target === null || logged === null) return adjustment
  const floorMet =
    pair.prescribed.repMin === null ||
    (pair.actual.reps !== null && pair.actual.reps >= pair.prescribed.repMin)
  if (!floorMet) return adjustment // a missed floor is the rep rules' jurisdiction
  if (logged < target + OVERSHOOT_RPE_THRESHOLD) return adjustment

  if (adjustment !== null && adjustment.action === 'step' && mode === 'range') {
    return { ...adjustment, action: 'repeat', deltaKg: 0, effortContext: 'overshoot' }
  }
  if (adjustment === null && mode === 'fixed') {
    // A null fixed-mode verdict means "let the scheme increment" — the hold
    // IS the intervention, synthesized with the newest session's evidence.
    const loadKg = pair.prescribed.loadKg
    if (loadKg === null) return adjustment
    const scorableSets = newest.prescribed.filter(
      (p) => p.setType !== 'warmup' && p.loadKg !== null,
    ).length
    return {
      action: 'repeat',
      deltaKg: 0,
      suggestEarlyDeload: false,
      stalledLoads: [loadKg],
      evidence: {
        missedSets: 0,
        scorableSets,
        repFloor: pair.prescribed.repMin ?? 0,
        loadKg,
      },
      effortContext: 'overshoot',
    }
  }
  return adjustment
}
