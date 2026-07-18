import { kgToDisplay, type WeightUnit } from './units'
import type { DerivedSet } from './progression'

/**
 * Auto-regulation Layer 1: performance-reactive adjustments derived ONLY from
 * already-logged data (see auto-regulation.prd.md). Pure — callers assemble
 * prior sessions (prescribed-at-instantiation snapshots + actuals), this
 * module answers "should the next prescription back off, and why" with a
 * reason a lifter can audit. Transparency is the contract: no adjustment
 * without a reason.
 *
 * v1 rules are REP-based. RPE over/undershoot rules are specified in the PRD
 * but blocked on data: logged sets carry no actual RPE (only prescriptions
 * do), so they wait for an optional per-set RPE input.
 *
 * Scope: the `linear` scheme ONLY — the one that blindly adds weight every
 * week. Explicitly out for v1:
 * - double-progression already holds its load until repMax is hit on every
 *   set; a stall there is the scheme working, not failing.
 * - percent-1rm is NOT self-correcting (its trainingMax is static) — a
 *   future candidate once trainingMax adjustment exists.
 * - amrap-cycle bumps its trainingMax unconditionally per completed wave —
 *   also future work.
 * - rpe-target derives from e1RM and genuinely self-corrects.
 * Overrides always outrank autoreg (applied later in the precedence chain,
 * same as scheme loads).
 */

export interface AutoregPrescribedSet {
  /** Pairing key against the actual side — never positional. */
  setNumber: number
  repMin: number | null
  loadKg: number | null
  /** Warm-ups never stall a lift. */
  setType?: string
}

export interface AutoregActualSet {
  /** Pairing key against the prescribed side — never positional. */
  setNumber: number
  reps: number | null
  weightKg: number | null
  completed: boolean
  setType?: string
}

/** One prior session of the exercise: what the snapshot says was prescribed,
 *  what happened. Both sides come from the SAME logged set rows (the
 *  prescribed_* snapshot columns), never re-derived from today's plan. */
export interface AutoregSession {
  prescribed: AutoregPrescribedSet[]
  actual: AutoregActualSet[]
}

export interface AutoregAdjustment {
  action: 'repeat' | 'decrement'
  /** Relative to the STALLED evidence load (`evidence.loadKg`): 0 (repeat) or
   *  −backoffKg (escalated back-off) — see `applyAutoregToSets`. */
  deltaKg: number
  /** Three consecutive stalls: worth pulling the deload forward. */
  suggestEarlyDeload: boolean
  /** Prescribed-at-stall load per setNumber from the latest stalled session,
   *  every non-warmup set with a load — each next-week set is capped against
   *  ITS OWN entry (a passing top set is never slashed because a lighter
   *  volume set failed), and backoff/amrap volume work is frozen so it can't
   *  climb past a frozen top set. */
  stalledLoadBySetNumber: Readonly<Record<number, number>>
  /** Structured evidence for the reason line — formatting is display-side.
   *  `repFloor`/`loadKg` name the HEAVIEST missed set. */
  evidence: {
    missedSets: number
    scorableSets: number
    repFloor: number
    loadKg: number
  }
}

/** Attempted-at-load tolerance. 0.05 kg absorbs lb→kg round-trip drift (an
 *  executed sweep showed stored-vs-prescribed drift up to 0.02 kg; the prior
 *  0.011 excluded ~17% of legitimate at-load attempts) while micro-loading
 *  noise still can't hide a stall. */
const LOAD_EPSILON_KG = 0.05

/** Consecutive stalled sessions required before the load is decremented
 *  (StrongLifts' cited rule: deload after the THIRD failed session). */
const STALLS_BEFORE_DECREMENT = 3

/** How many prior sessions the rules consult — the escalation window. */
export const AUTOREG_SESSION_WINDOW = STALLS_BEFORE_DECREMENT

/** Escalated back-off fraction — the field standard (StrongLifts deloads 10%
 *  after repeated fails; GZCLP resets to 85–90%), not a micro-increment: one
 *  2.5 kg step off a stalled 100 kg lift would re-prescribe the same grind. */
const BACKOFF_FRACTION = 0.1

/** Ceiling on the back-off: the one-increment floor must never gut a light
 *  lift (backoffKg(10, 25) without it would prescribe −25 off a 10 kg lift). */
const MAX_BACKOFF_FRACTION = 0.25

/** ~10% of the stalled load, snapped to loadable increments (≥ one), capped
 *  at 25% of the load — the cap beats the one-increment floor on tiny loads,
 *  so a decrement can never zero out (or invert) a prescription. */
export function backoffKg(loadKg: number, incrementKg: number): number {
  if (!Number.isFinite(loadKg) || !Number.isFinite(incrementKg)) return 0
  if (incrementKg <= 0 || loadKg <= 0) return 0
  const snapped = Math.max(
    incrementKg,
    Math.round((loadKg * BACKOFF_FRACTION) / incrementKg) * incrementKg,
  )
  return Math.min(snapped, loadKg * MAX_BACKOFF_FRACTION)
}

/** First occurrence per setNumber — duplicate numbers can't double-testify. */
function bySetNumber<T extends { setNumber: number }>(rows: readonly T[]): Map<number, T> {
  const map = new Map<number, T>()
  for (const row of rows) {
    if (!map.has(row.setNumber)) map.set(row.setNumber, row)
  }
  return map
}

function isWorking(setType?: string): boolean {
  return setType === undefined || setType === 'working'
}

/**
 * A session stalled when, on at least half of its scorable working sets, the
 * lifter finished under the rep floor. Prescribed and actual sets pair BY
 * `setNumber` — unpaired entries on either side (extra ad-hoc sets, skipped
 * rows) are ignored, no length assumptions. A pair is scorable when the
 * snapshot carries a floor + load, the actual is completed with reps+weight,
 * and the weight is ≥ the prescribed load − epsilon (attempted lighter =
 * self-regulation already happened, not a stall). Evidence names the HEAVIEST
 * missed set. Null when nothing is scorable (deviated exercise, BW day,
 * pre-snapshot history): no evidence either way, never a stall from silence.
 */
export function sessionStall(
  session: AutoregSession,
): { missedSets: number; scorableSets: number; repFloor: number; loadKg: number } | null {
  const actualByNumber = bySetNumber(session.actual.filter((set) => isWorking(set.setType)))

  let scorable = 0
  let missed = 0
  let heaviestMissed: { repFloor: number; loadKg: number } | null = null

  for (const plan of bySetNumber(session.prescribed.filter((s) => isWorking(s.setType))).values()) {
    if (plan.repMin === null || plan.loadKg === null) continue
    const done = actualByNumber.get(plan.setNumber)
    if (!done?.completed || done.reps === null || done.weightKg === null) continue
    if (done.weightKg < plan.loadKg - LOAD_EPSILON_KG) continue
    scorable += 1
    if (done.reps < plan.repMin) {
      missed += 1
      if (heaviestMissed === null || plan.loadKg > heaviestMissed.loadKg) {
        heaviestMissed = { repFloor: plan.repMin, loadKg: plan.loadKg }
      }
    }
  }

  if (scorable === 0 || heaviestMissed === null) return null
  return missed * 2 >= scorable
    ? { missedSets: missed, scorableSets: scorable, ...heaviestMissed }
    : null
}

/** Every non-warmup prescribed load of the session, keyed by setNumber — the
 *  per-set cap basis for `applyAutoregToSets`. */
function stalledLoads(session: AutoregSession): Record<number, number> {
  const loads: Record<number, number> = {}
  for (const plan of bySetNumber(session.prescribed).values()) {
    if (plan.setType === 'warmup' || plan.loadKg === null) continue
    loads[plan.setNumber] = plan.loadKg
  }
  return loads
}

/**
 * The Layer 1 verdict for one exercise from its prior sessions. HARD
 * PRECONDITION: `sessions` is newest-first (callers order by startedAt desc,
 * id desc); a mis-ordered array would count the wrong streak. Only the first
 * `AUTOREG_SESSION_WINDOW` sessions are consulted (extras ignored). One or
 * two consecutive stalls → repeat the load; three consecutive → back off
 * ~10% and suggest pulling the deload forward. Null = no adjustment (schemes
 * proceed untouched).
 */
export function autoregulate(
  incrementKg: number,
  sessions: readonly AutoregSession[],
): AutoregAdjustment | null {
  const window = sessions.slice(0, AUTOREG_SESSION_WINDOW)
  const latest = window[0]
  if (!latest) return null
  const latestStall = sessionStall(latest)
  if (!latestStall) return null

  let consecutive = 1
  for (const session of window.slice(1)) {
    if (sessionStall(session) === null) break
    consecutive += 1
  }

  const shared = {
    stalledLoadBySetNumber: stalledLoads(latest),
    evidence: latestStall,
  }
  return consecutive >= STALLS_BEFORE_DECREMENT
    ? {
        action: 'decrement' as const,
        deltaKg: -backoffKg(latestStall.loadKg, incrementKg),
        suggestEarlyDeload: true,
        ...shared,
      }
    : { action: 'repeat' as const, deltaKg: 0, suggestEarlyDeload: false, ...shared }
}

/**
 * Applies a Layer 1 adjustment to a week's scheme-derived sets, BEFORE
 * overrides (override > autoreg — the caller merges overrides on top and they
 * replace both the load and the stamp). Each non-warmup scheme set is capped
 * against ITS OWN prescribed-at-stall load (matched by setNumber) — never one
 * global cap, so a set that passed at 100 kg is not slashed because a 90 kg
 * volume set failed. On decrement every cap scales by the evidence set's
 * back-off fraction. Sets with no stalled-session counterpart, warmups, and
 * non-scheme passthroughs are untouched; loads are never raised (a scheme
 * already below its cap keeps its own load). Adjusted sets keep their
 * pre-autoreg value in `schemeLoadKg` so surfaces can offer "use plan as
 * written". Scoring (the verdict) remains working-sets-only — backoff/amrap
 * sets are only FROZEN here so volume work can't climb past a frozen top set.
 */
export function applyAutoregToSets(
  sets: readonly DerivedSet[],
  adjustment: AutoregAdjustment,
): DerivedSet[] {
  const fraction =
    adjustment.evidence.loadKg > 0
      ? (adjustment.evidence.loadKg + adjustment.deltaKg) / adjustment.evidence.loadKg
      : 1
  return sets.map((set) => {
    if (set.setType === 'warmup' || set.derivedFrom !== 'scheme' || set.loadKg === null) return set
    const stalledLoadKg = adjustment.stalledLoadBySetNumber[set.setNumber]
    if (stalledLoadKg === undefined) return set
    const targetKg = Math.max(0, stalledLoadKg * fraction)
    return {
      ...set,
      loadKg: Math.min(set.loadKg, targetKg),
      derivedFrom: 'autoreg',
      schemeLoadKg: set.loadKg,
    }
  })
}

/**
 * The lifter-facing reason line — every adjustment ships one (the PRD's
 * transparency contract). Display unit applied here, not in the engine.
 *   "Missed 8 reps on 2 of 3 sets at 100 kg — repeating the load"
 *   "Third straight stall at 100 kg — backing off 10 kg (~10%)"
 */
export function autoregReason(adjustment: AutoregAdjustment, unit: WeightUnit): string {
  const load = `${kgToDisplay(adjustment.evidence.loadKg, unit)} ${unit}`
  if (adjustment.action === 'decrement') {
    const backoff = `${kgToDisplay(-adjustment.deltaKg, unit)} ${unit}`
    return `Third straight stall at ${load} — backing off ${backoff} (~10%)`
  }
  const { missedSets, scorableSets, repFloor } = adjustment.evidence
  return `Missed ${repFloor} reps on ${missedSets} of ${scorableSets} sets at ${load} — repeating the load`
}
