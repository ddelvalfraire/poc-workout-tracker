import { kgToDisplay, type WeightUnit } from './units'

/**
 * Auto-regulation Layer 1: performance-reactive adjustments derived ONLY from
 * already-logged data (see auto-regulation.prd.md). Pure — callers assemble
 * prior sessions (prescription + actuals), this module answers "should the
 * next prescription back off, and why" with a reason a lifter can audit.
 * Transparency is the contract: no adjustment without a reason.
 *
 * v1 rules are REP-based. RPE over/undershoot rules are specified in the PRD
 * but blocked on data: logged sets carry no actual RPE (only prescriptions
 * do), so they wait for an optional per-set RPE input.
 *
 * Scope: linear and double-progression schemes — the ones that blindly add
 * weight. rpe-target/percent-1rm derive from e1RM and self-correct;
 * amrap-cycle has its own wave math. Overrides always outrank autoreg
 * (applied later in the precedence chain, same as scheme loads).
 */

export interface AutoregPrescribedSet {
  repMin: number | null
  loadKg: number | null
  /** Warm-ups never stall a lift. */
  setType?: string
}

export interface AutoregActualSet {
  reps: number | null
  weightKg: number | null
  completed: boolean
  setType?: string
}

/** One prior session of the exercise: what the plan asked, what happened. */
export interface AutoregSession {
  prescribed: AutoregPrescribedSet[]
  actual: AutoregActualSet[]
}

export interface AutoregAdjustment {
  action: 'repeat' | 'decrement'
  /** Applied to the scheme-derived load: 0 (repeat) or −incrementKg. */
  deltaKg: number
  /** Two consecutive stalls: worth pulling the deload forward. */
  suggestEarlyDeload: boolean
  /** Structured evidence for the reason line — formatting is display-side. */
  evidence: {
    missedSets: number
    scorableSets: number
    repFloor: number
    loadKg: number
  }
}

/** Attempted-at-load tolerance: micro-loading noise must not hide a stall. */
const LOAD_EPSILON_KG = 0.011

/**
 * A session stalled when, on at least half of its scorable working sets
 * (prescribed floor + load, actually attempted at ≥ that load), the lifter
 * finished under the rep floor. Sets attempted LIGHTER than prescribed are
 * excluded — self-regulating down is already an adjustment, not a stall.
 * Null when the session has no scorable sets (deviated exercise, BW day):
 * no evidence either way, never a stall verdict from silence.
 */
export function sessionStall(
  session: AutoregSession,
): { missedSets: number; scorableSets: number; repFloor: number; loadKg: number } | null {
  let scorable = 0
  let missed = 0
  let repFloor = 0
  let loadKg = 0
  const working = (setType?: string) => setType === undefined || setType === 'working'

  const prescribed = session.prescribed.filter((set) => working(set.setType))
  const actual = session.actual.filter((set) => working(set.setType))

  for (const [index, plan] of prescribed.entries()) {
    if (plan.repMin === null || plan.loadKg === null) continue
    const done = actual[index]
    if (!done?.completed || done.reps === null || done.weightKg === null) continue
    if (done.weightKg < plan.loadKg - LOAD_EPSILON_KG) continue
    scorable += 1
    repFloor = plan.repMin
    loadKg = plan.loadKg
    if (done.reps < plan.repMin) missed += 1
  }

  if (scorable === 0) return null
  return missed * 2 >= scorable && missed > 0
    ? { missedSets: missed, scorableSets: scorable, repFloor, loadKg }
    : null
}

/**
 * The Layer 1 verdict for one exercise, from its prior sessions (newest
 * first; only the two most recent are consulted). One stall → repeat the
 * load; two consecutive → back off one increment and suggest pulling the
 * deload forward. Null = no adjustment (schemes proceed untouched).
 */
export function autoregulate(
  incrementKg: number,
  sessions: readonly AutoregSession[],
): AutoregAdjustment | null {
  const latest = sessions[0]
  if (!latest) return null
  const latestStall = sessionStall(latest)
  if (!latestStall) return null

  const previous = sessions[1]
  const consecutive = previous ? sessionStall(previous) !== null : false

  return consecutive
    ? {
        action: 'decrement',
        deltaKg: -incrementKg,
        suggestEarlyDeload: true,
        evidence: latestStall,
      }
    : { action: 'repeat', deltaKg: 0, suggestEarlyDeload: false, evidence: latestStall }
}

/**
 * The lifter-facing reason line — every adjustment ships one (the PRD's
 * transparency contract). Display unit applied here, not in the engine.
 *   "Missed 8 reps on 2 of 3 sets at 100 kg — repeating the load"
 *   "Second straight stall at 100 kg — backing off one increment"
 */
export function autoregReason(adjustment: AutoregAdjustment, unit: WeightUnit): string {
  const load = `${kgToDisplay(adjustment.evidence.loadKg, unit)} ${unit}`
  if (adjustment.action === 'decrement') {
    return `Second straight stall at ${load} — backing off one increment`
  }
  const { missedSets, scorableSets, repFloor } = adjustment.evidence
  return `Missed ${repFloor} reps on ${missedSets} of ${scorableSets} sets at ${load} — repeating the load`
}
