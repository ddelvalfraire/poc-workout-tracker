import type { WeightUnit } from './units'
// Reason strings print loads through the #226 quantizer — a lifter must
// never read an unloadable number like 66.6 lb in the transparency copy.
// `loadsMatch` widens the C2 evidence identity across the quantization
// deploy boundary (raw epsilon OR same display increment).
import {
  LOAD_EPSILON_KG,
  loadsMatch,
  quantizeAdjustedLoadKg,
  quantizeDisplayLoad,
} from './load-quantize'
import { kgToDisplay } from './units'
// Reason lines share the double-progression hold clause with the scheme-copy
// module (#228) — one voice for "hit N reps, then the weight goes up".
import { repFillHoldReason } from './scheme-copy'
import { estimate1RM } from './one-rep-max'
import type { OvershootPolicy } from './overshoot-policy'
import type { DerivedSet } from './progression'
import type { DietPhase } from './program-input'

/**
 * Auto-regulation Layer 1: performance-reactive adjustments derived ONLY from
 * already-logged data (see auto-regulation.prd.md). Pure — callers assemble
 * prior sessions (prescribed-at-instantiation snapshots + actuals), this
 * module answers "should the next prescription back off, and why" with a
 * reason a lifter can audit. Transparency is the contract: no adjustment
 * without a reason.
 *
 * EVIDENCE IS LOAD-KEYED, NEVER POSITIONAL (adversarial review 2026-08-08,
 * finding C2): program edits renumber sets, so a setNumber means nothing
 * across sessions. Prescribed↔actual pairing WITHIN one session still uses
 * setNumber (that snapshot is internally consistent); every cross-session
 * structure — stall caps, anchors, comparable totals, range tops — keys on
 * the epsilon-bucketed prescribed load instead. A stall at prescribed load X
 * caps today's working sets whose scheme load ≥ X − ε to the stalled
 * outcome; anchors key the same way.
 *
 * Scope — the rule sets:
 * - FIXED (`autoregulate`): fixed-rep `linear`. Stall scoring follows the
 *   program's STALL POLICY (`AutoregStallPolicy`): 'all-sets' (the default)
 *   stalls when ANY scorable working set finishes under its rep floor (C1 —
 *   the StrongLifts/Starting Strength failed-session definition);
 *   'first-set' lets ONLY the lowest-setNumber working set govern (the
 *   top-set-driven convention — 8,8,6 with the first set at its floor
 *   progresses). Either way: repeat, then back off after three consecutive
 *   stalls AT THE SAME prescribed top load (H2 — any prescribed-load change,
 *   including an applied back-off, resets the streak). The policy also
 *   drives the M4 early-deload flag scoring; RANGE mode is UNAFFECTED — its
 *   stall is total-rep-gain over comparable sessions, not floor misses, so
 *   there is no per-set floor for a policy to select.
 * - RANGE (`autoregulateRange`): double progression for rep ranges. Ranged
 *   working rows are scored by fill/hold; fixed rows in a MIXED template
 *   join floor scoring only (H3) — a mixed shape no longer disables range
 *   protection.
 * - ANCHOR (`autoregulateAnchor`): performed-load anchoring for schemes that
 *   can prescribe load-less sets.
 * - EARLY-DELOAD FLAG (`autoregulateEarlyDeload`): percent-1rm / amrap-cycle
 *   floor scoring drives `suggestEarlyDeload` ONLY (M4) — the scheme owns
 *   its loads, so a three-stall streak flags "training max likely set too
 *   high" without ever touching a prescription.
 * All loaded modes also FOLLOW THE LIFTER DOWN (H1): three consecutive
 * comparable sessions worked entirely at ≤ 95% of plan with the floors met
 * propose anchoring the loads down to what was actually lifted — load
 * selection is itself the primary autoregulation signal (RTS/Juggernaut
 * precedent). Up-anchors (outperform) require TWO consecutive qualifying
 * sessions (M2); no verdict of any kind issues without an evidence quorum of
 * at least half the snapshot's working sets (M3). Overrides always outrank
 * autoreg (applied later in the precedence chain, same as scheme loads).
 *
 * v1 rules are REP-based. Logged per-set effort (sets.rir/rpe via the chips,
 * RPE/RIR §2) now rides along on both session sides with its prescription
 * snapshot (prescribedRir/prescribedRpe) — the effort gate consumes it
 * (RPE plan slices 3–4); the rep rules themselves stay effort-blind.
 */

/** Per-program FIXED-mode stall policy (programs.autoreg_stall_policy):
 *  'all-sets' — ANY scorable working set under its floor stalls the session
 *  (C1, the default); 'first-set' — ONLY the lowest-setNumber non-warmup
 *  working prescribed set governs (within-session setNumber IS valid — never
 *  cross-session). An unscorable governing set (skipped/lighter/retagged)
 *  yields NO verdict — silence over corruption, never a fallback set. */
export type AutoregStallPolicy = 'all-sets' | 'first-set'

export interface AutoregPrescribedSet {
  /** Pairing key against the actual side WITHIN this session only — never
   *  meaningful across sessions. */
  setNumber: number
  repMin: number | null
  loadKg: number | null
  /** Warm-ups never stall a lift. */
  setType?: string
  /** Prescribed effort targets from the snapshot columns (RPE plan slice 2) —
   *  the effort gate's comparison baseline; absent/null = no target. */
  rir?: number | null
  rpe?: number | null
}

export interface AutoregActualSet {
  /** Pairing key against the prescribed side WITHIN this session only. */
  setNumber: number
  reps: number | null
  weightKg: number | null
  completed: boolean
  setType?: string
  /** Logged effort (the chips) — absent/null = not logged (opt-in). */
  rir?: number | null
  rpe?: number | null
}

/** One prior session of the exercise: what the snapshot says was prescribed,
 *  what happened. Both sides come from the SAME logged set rows (the
 *  prescribed_* snapshot columns), never re-derived from today's plan. */
export interface AutoregSession {
  /** Epoch ms the session started — the ordering contract (H6): every entry
   *  point sorts descending on this instead of trusting array order. */
  startedAtMs: number
  prescribed: AutoregPrescribedSet[]
  actual: AutoregActualSet[]
}

/** One load-keyed anchor bucket (C2): sets prescribed at (within ε of, or
 *  above) `prescribedLoadKg` anchor at `anchorKg`; the null bucket anchors
 *  today's load-less scheme sets. */
export interface AutoregAnchor {
  prescribedLoadKg: number | null
  anchorKg: number
}

/** Today's plan-side shape for ONE working row, used by range mode: the
 *  scheme-derived load and the range top (null repMax = a fixed row, which
 *  joins floor scoring only — H3). */
export interface AutoregRangeRow {
  loadKg: number | null
  repMax: number | null
}

export interface AutoregAdjustment {
  /** `'flag'` (M4) is advisory-only: `suggestEarlyDeload` without any load
   *  adjustment — `applyAutoregToSets` passes every set through. */
  action: 'repeat' | 'decrement' | 'step' | 'anchor' | 'flag'
  /** Relative to the evidence load (`evidence.loadKg`): 0 (repeat/flag),
   *  −backoffKg (escalated back-off), +stepKg (range filled), or the
   *  heaviest bucket's anchored-minus-prescribed margin (anchor). */
  deltaKg: number
  /** Three consecutive stalls: worth pulling the deload forward. */
  suggestEarlyDeload: boolean
  /** The latest session's non-warmup prescribed loads, ε-deduped and sorted
   *  descending — the load-keyed cap basis (C2): a derived working set at
   *  load L is capped against the LARGEST evidence load X with L ≥ X − ε
   *  (its own bucket), so a stalled set can't escape its cap by renumbering
   *  and foreign evidence can't slash an unrelated set. */
  stalledLoads: readonly number[]
  /** Load-keyed anchors (C2): outperform / follow-down / null-load evidence
   *  per prescribed-load bucket. Anchored sets are prescribed EXACTLY the
   *  bucket's load next derive; on a `step` verdict the step composes ON TOP
   *  of the anchored load. Absent buckets anchor nothing — silence over
   *  corruption, per bucket. */
  anchorLoads?: readonly AutoregAnchor[]
  /** Reason-line evidence for anchors (`fromLoadKg` = heaviest bucket's
   *  prescribed load; null = the anchored sets had no prescribed load). A
   *  `toLoadKg` below `fromLoadKg` is a follow-down anchor (H1). */
  anchor?: {
    fromLoadKg: number | null
    toLoadKg: number
  }
  /** Structured evidence for the reason line — formatting is display-side.
   *  Fixed mode: `repFloor`/`loadKg` name the HEAVIEST missed set. Range
   *  mode: `loadKg` is the heaviest scorable prescribed load, `repFloor` the
   *  range top governing that set (0 when no top governs it), `missedSets`
   *  the sets still under their targets. */
  evidence: {
    missedSets: number
    scorableSets: number
    repFloor: number
    loadKg: number
  }
  /** Diet-phase annotation (applyDietPhaseToAdjustment): present ONLY when
   *  the program is CUTTING and the verdict is stall-shaped (repeat /
   *  decrement-held / flag). Copy-side framing only — stalls are EXPECTED
   *  under a deficit and holding is the win; the phase never changes a load
   *  (Murphy & Koehler: lean mass is what a cut impairs, strength stays
   *  comparable — so the copy never claims otherwise). */
  phaseContext?: 'cutting'
  /** The auto-backoff a cutting phase HELD (kg, positive): the H2 3-stall
   *  decrement fires as usual, but under 'cutting' the application is gated
   *  to a hold — this carries what WOULD have been cut so a batch-patch
   *  proposal can offer the backoff as the confirmable action (decline =
   *  hold). Absent everywhere else. */
  heldBackoffKg?: number
  /** The landing load a decrement was actually APPLIED at (kg) — stamped by
   *  the derive layer AFTER per-set quantization (`stampAppliedLoad`: the
   *  adjusted working set of the EVIDENCE bucket — the set whose scheme load
   *  matches `evidence.loadKg` — falling back to the heaviest adjusted set
   *  only when no set matches). `autoregReason`'s "Drop to X" prints THIS
   *  when present, so the reason and the prescription always speak from one
   *  number; absent (raw engine verdicts, invariant checks) the reason falls
   *  back to recomputing from the evidence load. */
  appliedLoadKg?: number
  /** Effort-gate annotation (lib/effort-gate.ts, RPE plan slice 3):
   *  'overshoot' — reps hit but the top set ran a full RPE point hot, the
   *  load holds instead of stepping; 'trend-veto' — H2's decrement was
   *  vetoed by a rising credited-e1RM trend (bad day, not a stall). Same
   *  additive-annotation contract as phaseContext. */
  effortContext?: 'overshoot' | 'trend-veto'
  /** Overshoot recognition (#227): the latest session held a completed
   *  working set that beat its SNAPSHOT prescription's e1RM at a different
   *  load/rep mix (lighter-but-more-reps). Display-side ONLY — a miss-shaped
   *  hold carrying this renders recognition ("Beat the target …"), never a
   *  "goal not met" line. Never changes a load (`applyAutoregToSets` ignores
   *  it); same additive-annotation contract as phaseContext/effortContext. */
  overshoot?: {
    reps: number
    weightKg: number
    targetReps: number
    targetLoadKg: number
  }
  /** Present ONLY on range-mode (double progression) verdicts. Totals sum
   *  at-load working reps over the load-comparable prior session
   *  (`prevTotalReps` null when no comparable prior session exists). */
  range?: {
    totalReps: number
    prevTotalReps: number | null
    /** Consecutive no-rep-gain sessions ending at the latest one. */
    stalls: number
  }
}

/** Outperform margin: performed must beat prescribed by ≥5% on EVERY scorable
 *  set before the program follows the lifter up — micro-loading past the plan
 *  is the scheme's job, a deliberate jump (120 done vs 80 planned) is not.
 *  The comparison keeps the same epsilon discipline as at-load pairing. */
const OUTPERFORM_FRACTION = 0.05

/** Follow-down margin (H1): a session counts as worked-lighter only when
 *  EVERY completed working attempt sat at ≤ 95% of its prescribed load —
 *  the mirror of the outperform margin. */
const FOLLOW_DOWN_FRACTION = 0.95

/** Consecutive stalled sessions required before the load is decremented
 *  (StrongLifts' cited rule: deload after the THIRD failed session). Also the
 *  follow-down session count (H1) and the early-deload flag streak (M4). */
const STALLS_BEFORE_DECREMENT = 3

/** Consecutive qualifying sessions required before an up-anchor (outperform)
 *  is proposed (M2) — no methodology chases one good day. */
const OUTPERFORM_SESSIONS_REQUIRED = 2

/** How many prior sessions the FIXED-mode rules consult — the escalation
 *  window. */
export const AUTOREG_SESSION_WINDOW = STALLS_BEFORE_DECREMENT

/** RANGE mode needs one more session than the stall count: a stall is a
 *  PAIR of sessions (no rep gain vs the previous one), so three consecutive
 *  stalls span four sessions. */
export const AUTOREG_RANGE_SESSION_WINDOW = STALLS_BEFORE_DECREMENT + 1

/** Step applied when the range fills and the exercise's progression carries
 *  no usable increment (incrementKg 0) — the smallest sensible total-load
 *  step, matching WEIGHT_STEP's kg semantics (2.5 kg / 5 lb). */
export const AUTOREG_DEFAULT_STEP_KG = 2.5

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

/** Newest-first by startedAtMs — the ordering contract (H6) is enforced
 *  defensively at every entry point rather than trusted from callers. */
function newestFirst(sessions: readonly AutoregSession[]): AutoregSession[] {
  return [...sessions].sort((a, b) => b.startedAtMs - a.startedAtMs)
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

/** ε-or-increment load identity (see load-quantize's `loadsMatch`): the raw
 *  epsilon, widened — when the active unit is known — to "same display
 *  increment", so pre-quantization snapshots keep matching their quantized
 *  re-derivations (#226 transitional bridge). */
function sameLoad(a: number, b: number, unit?: WeightUnit): boolean {
  return loadsMatch(a, b, LOAD_EPSILON_KG, unit)
}

/** Descending ε-deduped load buckets — the C2 evidence key. Values within
 *  epsilon (or the unit's increment) of an already-kept (heavier) bucket
 *  merge into it. */
function bucketLoads(loads: readonly number[], unit?: WeightUnit): number[] {
  const sorted = [...loads].sort((a, b) => b - a)
  const buckets: number[] = []
  for (const load of sorted) {
    if (buckets.length === 0 || !sameLoad(buckets[buckets.length - 1], load, unit)) {
      buckets.push(load)
    }
  }
  return buckets
}

/** The largest evidence load X with `loadKg ≥ X − ε` (or X in the same
 *  display increment) — the bucket a derived set belongs to. Undefined when
 *  the set sits below every evidence load (a genuinely new lighter set
 *  carries no evidence — untouched). */
function evidenceLoadFor(
  loads: readonly number[],
  loadKg: number,
  unit?: WeightUnit,
): number | undefined {
  let best: number | undefined
  for (const x of loads) {
    if (
      (loadKg >= x - LOAD_EPSILON_KG || sameLoad(loadKg, x, unit)) &&
      (best === undefined || x > best)
    ) {
      best = x
    }
  }
  return best
}

/** The anchor bucket a set at `loadKg` belongs to: the null bucket for
 *  load-less sets, else the same largest-at-or-below rule as
 *  `evidenceLoadFor`. Exported so plan-sync applies anchors to plan rows
 *  with exactly the engine's load-keying (C2). */
export function anchorLoadFor(
  anchors: readonly AutoregAnchor[] | undefined,
  loadKg: number | null,
  unit?: WeightUnit,
): number | undefined {
  if (!anchors) return undefined
  if (loadKg === null) return anchors.find((a) => a.prescribedLoadKg === null)?.anchorKg
  let best: AutoregAnchor | undefined
  for (const a of anchors) {
    if (a.prescribedLoadKg === null) continue
    if (loadKg < a.prescribedLoadKg - LOAD_EPSILON_KG && !sameLoad(loadKg, a.prescribedLoadKg, unit))
      continue
    if (best === undefined || a.prescribedLoadKg > (best.prescribedLoadKg ?? 0)) best = a
  }
  return best?.anchorKg
}

/** One scorable prescribed↔actual working pair (the shared evidence-quality
 *  rules): paired by setNumber WITHIN the session, snapshot carries a load,
 *  the actual is completed with reps+weight, and the weight is ≥ the
 *  prescribed load − epsilon (attempted lighter feeds the follow-down rule
 *  instead). `repMin` rides along nullable — FIXED mode additionally
 *  requires it. */
interface ScorablePair {
  /** Within-session pairing key — carried so the 'first-set' stall policy can
   *  find its governing set; never meaningful across sessions. */
  setNumber: number
  loadKg: number
  repMin: number | null
  reps: number
  /** Performed load — the outperform rule's anchor candidate. */
  weightKg: number
}

/** The completed working pairs of a session, split by attempt class: `atLoad`
 *  (≥ prescribed − ε, the scorable pairs) and `lighter` (≤ prescribed × 0.95
 *  + ε, the follow-down evidence — H1). Attempts strictly between the bands
 *  land in neither (ambiguous — silence). */
function workingPairs(session: AutoregSession): {
  atLoad: ScorablePair[]
  lighter: ScorablePair[]
} {
  const actualByNumber = bySetNumber(session.actual.filter((set) => isWorking(set.setType)))
  const atLoad: ScorablePair[] = []
  const lighter: ScorablePair[] = []
  for (const plan of bySetNumber(session.prescribed.filter((s) => isWorking(s.setType))).values()) {
    if (plan.loadKg === null) continue
    const done = actualByNumber.get(plan.setNumber)
    if (!done?.completed || done.reps === null || done.weightKg === null) continue
    const pair = {
      setNumber: plan.setNumber,
      loadKg: plan.loadKg,
      repMin: plan.repMin,
      reps: done.reps,
      weightKg: done.weightKg,
    }
    if (done.weightKg >= plan.loadKg - LOAD_EPSILON_KG) {
      atLoad.push(pair)
    } else if (
      done.weightKg > 0 &&
      done.weightKg <= plan.loadKg * FOLLOW_DOWN_FRACTION + LOAD_EPSILON_KG
    ) {
      lighter.push(pair)
    }
  }
  return { atLoad, lighter }
}

function scorablePairs(session: AutoregSession): ScorablePair[] {
  return workingPairs(session).atLoad
}

/** Epley inversion: the whole-rep count at `loadKg` equivalent to `e1rmKg`
 *  (floor — credit never rounds up past what was demonstrated). */
function equivalentRepsAt(loadKg: number, e1rmKg: number): number {
  return Math.floor(30 * (e1rmKg / loadKg - 1))
}

/**
 * The overshoot-policy credit for ONE actual set against its snapshot plan
 * (#227): null = no credit, facts stand raw. Crediting rewrites the set to
 * its goal-equivalent AT the prescribed load so every downstream rule
 * (bands, floors, range tops, totals, quorum) scores it under the strict
 * machinery unchanged:
 * - 'e1rm-equivalent' — a LIGHTER completed set whose e1RM meets the
 *   prescription's e1RM (repMin × prescribed load, both snapshot facts) is
 *   credited as its Epley-equivalent reps at the prescribed load. At-load
 *   sets keep their raw facts: fewer reps at the load IS a lower e1RM.
 * - 'any-metric' — permissive: reps ≥ target reps (any load), load ≥ target
 *   load (any reps), or e1RM ≥ target e1RM. A load-met set floor-credits its
 *   reps; a lighter set credits at the prescribed load with the best of its
 *   raw reps (when the rep metric hit) / e1RM-equivalent reps.
 * Crediting can only ever mark a goal MET — it never invents a stall, and
 * (deliberately) never composes with the outperform rule: the credited
 * weight is the prescribed load, so a credited set can't propose an
 * up-anchor or skip a progression step.
 */
function creditSet(
  plan: AutoregPrescribedSet | undefined,
  set: AutoregActualSet,
  policy: OvershootPolicy,
): AutoregActualSet | null {
  if (!plan || !isWorking(set.setType) || !set.completed) return null
  if (set.reps === null || set.weightKg === null || set.weightKg <= 0) return null
  if (plan.loadKg === null || plan.loadKg <= 0 || plan.repMin === null) return null
  const loadMet = set.weightKg >= plan.loadKg - LOAD_EPSILON_KG
  const repsMet = set.reps >= plan.repMin
  const performedE1rm = estimate1RM(set.reps, set.weightKg)
  const targetE1rm = estimate1RM(plan.repMin, plan.loadKg)
  const e1rmReps =
    performedE1rm !== null && targetE1rm !== null && performedE1rm >= targetE1rm
      ? equivalentRepsAt(plan.loadKg, performedE1rm)
      : null
  if (policy === 'e1rm-equivalent') {
    if (loadMet || e1rmReps === null) return null
    return { ...set, reps: Math.max(e1rmReps, plan.repMin), weightKg: plan.loadKg }
  }
  // any-metric.
  if (loadMet && repsMet) return null // a clean strict pass needs no credit
  if (loadMet) return { ...set, reps: plan.repMin } // load metric met — floor-credit
  if (!repsMet && e1rmReps === null) return null // lighter AND no metric met
  return {
    ...set,
    reps: Math.max(repsMet ? set.reps : 0, e1rmReps ?? 0, plan.repMin),
    weightKg: plan.loadKg,
  }
}

/**
 * The overshoot-policy view of the sessions (#227): under 'strict-load' the
 * input passes through untouched (byte-identical scoring — the default for
 * every load-anchored scheme); under a crediting policy each actual working
 * set that beat its snapshot prescription on the policy's metric is
 * rewritten to its goal-equivalent at the prescribed load (see `creditSet`)
 * BEFORE any rule runs. Evaluation stays snapshot-against-actual — the plan
 * side is never touched, and un-credited sets keep their raw facts.
 */
function creditSessions(
  sessions: readonly AutoregSession[],
  policy: OvershootPolicy,
): readonly AutoregSession[] {
  if (policy === 'strict-load') return sessions
  return sessions.map((session) => {
    const plans = bySetNumber(session.prescribed.filter((s) => isWorking(s.setType)))
    let changed = false
    const actual = session.actual.map((set) => {
      const credited = creditSet(plans.get(set.setNumber), set, policy)
      if (credited === null) return set
      changed = true
      return credited
    })
    return changed ? { ...session, actual } : session
  })
}

/**
 * The display-side overshoot fact of ONE session (#227's reported bug):
 * the completed working set — heaviest prescribed load first — that FAILED
 * the strict at-load band yet beat its snapshot prescription's e1RM
 * (estimate1RM(repMin, loadKg)). Null when no set overshot. Policy-blind on
 * purpose: whatever the scoring policy says about progression, an
 * e1RM-exceeding performance must never RENDER as "goal not met" — verdicts
 * carry this annotation so `autoregReason` can lead with recognition.
 */
export function sessionOvershoot(
  session: AutoregSession,
): NonNullable<AutoregAdjustment['overshoot']> | null {
  const actualByNumber = bySetNumber(session.actual.filter((set) => isWorking(set.setType)))
  let best: NonNullable<AutoregAdjustment['overshoot']> | null = null
  for (const plan of bySetNumber(session.prescribed.filter((s) => isWorking(s.setType))).values()) {
    if (plan.loadKg === null || plan.loadKg <= 0 || plan.repMin === null) continue
    const done = actualByNumber.get(plan.setNumber)
    if (!done?.completed || done.reps === null || done.weightKg === null) continue
    if (done.weightKg <= 0 || done.weightKg >= plan.loadKg - LOAD_EPSILON_KG) continue
    const performedE1rm = estimate1RM(done.reps, done.weightKg)
    const targetE1rm = estimate1RM(plan.repMin, plan.loadKg)
    if (performedE1rm === null || targetE1rm === null || performedE1rm < targetE1rm) continue
    if (best === null || plan.loadKg > best.targetLoadKg) {
      best = {
        reps: done.reps,
        weightKg: done.weightKg,
        targetReps: plan.repMin,
        targetLoadKg: plan.loadKg,
      }
    }
  }
  return best
}

/** Working sets the snapshot actually prescribed something for — the quorum
 *  denominator (M3). Pre-snapshot rows (null load AND null floor) are not
 *  snapshots and never count. */
function snapshotWorkingSetCount(session: AutoregSession): number {
  let count = 0
  for (const plan of bySetNumber(session.prescribed.filter((s) => isWorking(s.setType))).values()) {
    if (plan.loadKg !== null || plan.repMin !== null) count += 1
  }
  return count
}

/** The M3 evidence quorum: a verdict needs scorable evidence on at least
 *  half (ceil) of the snapshot's working sets — a warm-up retag or a pile of
 *  skipped rows must not let one surviving set speak for the exercise.
 *  Single-working-set exercises remain 1-of-1 (unavoidable). */
function meetsQuorum(evidenceCount: number, session: AutoregSession): boolean {
  return evidenceCount > 0 && evidenceCount * 2 >= snapshotWorkingSetCount(session)
}

/** Performed-load anchor for the session's NULL-load prescriptions: working
 *  sets whose snapshot carries no load but a real floor (a null floor beside
 *  the null load means NO snapshot at all — cold-start silence), completed
 *  with reps + a positive weight. Collapsed to ONE null bucket at the
 *  minimum performed load — with no prescribed load to key on, the most
 *  conservative demonstrated load is the only order-free anchor (C2). */
function nullLoadAnchor(session: AutoregSession): { count: number; anchorKg: number } | null {
  const actualByNumber = bySetNumber(session.actual.filter((set) => isWorking(set.setType)))
  const loads: number[] = []
  for (const plan of bySetNumber(session.prescribed.filter((s) => isWorking(s.setType))).values()) {
    if (plan.loadKg !== null || plan.repMin === null) continue
    const done = actualByNumber.get(plan.setNumber)
    if (!done?.completed || done.reps === null || done.weightKg === null) continue
    if (done.weightKg <= 0) continue
    loads.push(done.weightKg)
  }
  if (loads.length === 0) return null
  return { count: loads.length, anchorKg: Math.min(...loads) }
}

interface OutperformEvidence {
  /** Load-keyed anchor buckets (prescribed → performed), heaviest first. */
  buckets: AutoregAnchor[]
  /** Heaviest-bucket evidence, per the engine's convention. */
  fromLoadKg: number
  toLoadKg: number
  repFloor: number
}

/** Load-keyed anchor buckets from performed pairs, heaviest prescription
 *  first: pairs within ε of a bucket's prescribed load share it, and the
 *  performed load NEAREST the prescription wins the bucket — with no per-set
 *  identity across sessions, the least-surprising anchor is the honest one. */
function anchorBuckets(pairs: readonly ScorablePair[], unit?: WeightUnit): AutoregAnchor[] {
  const loads = bucketLoads(
    pairs.map((p) => p.loadKg),
    unit,
  )
  return loads.map((prescribedLoadKg) => {
    const members = pairs.filter((p) => sameLoad(p.loadKg, prescribedLoadKg, unit))
    const anchorKg = members.reduce((best, p) =>
      Math.abs(p.weightKg - prescribedLoadKg) < Math.abs(best.weightKg - prescribedLoadKg)
        ? p
        : best,
    ).weightKg
    return { prescribedLoadKg, anchorKg }
  })
}

/** The outperform evidence for one session's scorable pairs: EVERY pair must
 *  carry a positive prescribed load, a known rep floor the lifter met, and a
 *  performed load ≥ prescribed × 1.05 (epsilon-tolerant). All-or-nothing by
 *  design — one set at plan (or one ambiguous snapshot) means the session
 *  does not testify to a deliberate jump, and outperforming load while
 *  missing reps is NOT an outperform. Null = no evidence. */
function outperformAnchors(
  pairs: readonly ScorablePair[],
  unit?: WeightUnit,
): OutperformEvidence | null {
  if (pairs.length === 0) return null
  for (const pair of pairs) {
    if (pair.loadKg <= 0 || pair.repMin === null || pair.reps < pair.repMin) return null
    if (pair.weightKg < pair.loadKg * (1 + OUTPERFORM_FRACTION) - LOAD_EPSILON_KG) return null
  }
  const buckets = anchorBuckets(pairs, unit)
  const heaviest = pairs.reduce((a, b) => (b.loadKg > a.loadKg ? b : a))
  return {
    buckets,
    fromLoadKg: buckets[0].prescribedLoadKg ?? heaviest.loadKg,
    toLoadKg: buckets[0].anchorKg,
    repFloor: heaviest.repMin ?? 0,
  }
}

/** M2: an up-anchor needs `OUTPERFORM_SESSIONS_REQUIRED` consecutive
 *  qualifying sessions — the previous session must ALSO have outperformed
 *  (quorum-met) before the program follows the lifter up. The anchor values
 *  still come from the LATEST session. */
function confirmedOutperform(
  latest: OutperformEvidence | null,
  window: readonly AutoregSession[],
  unit?: WeightUnit,
): OutperformEvidence | null {
  if (!latest) return null
  for (let i = 1; i < OUTPERFORM_SESSIONS_REQUIRED; i++) {
    const previous = window[i]
    if (!previous) return null
    const previousPairs = scorablePairs(previous)
    if (!meetsQuorum(previousPairs.length, previous)) return null
    if (outperformAnchors(previousPairs, unit) === null) return null
  }
  return latest
}

/** The 'first-set' stall verdict: ONLY the lowest-setNumber non-warmup
 *  working prescribed set governs. Its scorable pair (floor + load on the
 *  snapshot, completed at-load actual) under the floor stalls the session;
 *  a hit floor progresses it regardless of the other sets. An unscorable
 *  governing set is NO verdict — never a fallback to another set — and its
 *  scorability IS the quorum here (M3 collapses to the one set that can
 *  testify): the evidence is exactly the governing set's load/floor. */
function firstSetStall(
  session: AutoregSession,
): { missedSets: number; scorableSets: number; repFloor: number; loadKg: number } | null {
  const workingPlans = [
    ...bySetNumber(session.prescribed.filter((s) => isWorking(s.setType))).values(),
  ]
  if (workingPlans.length === 0) return null
  const governingNumber = Math.min(...workingPlans.map((p) => p.setNumber))
  const pair = scorablePairs(session).find(
    (p): p is ScorablePair & { repMin: number } =>
      p.setNumber === governingNumber && p.repMin !== null,
  )
  if (!pair) return null
  if (pair.reps >= pair.repMin) return null
  return { missedSets: 1, scorableSets: 1, repFloor: pair.repMin, loadKg: pair.loadKg }
}

/**
 * The FIXED-mode stall verdict for one session, per the program's stall
 * policy. 'all-sets' (C1 — the StrongLifts/Starting Strength failed-session
 * definition: 8,8,6 is a failed session, not a pass): ANY scorable working
 * set under its rep floor stalls, evidence names the HEAVIEST missed set,
 * and the M3 quorum gates the verdict. 'first-set': only the governing set
 * speaks — see `firstSetStall`. Prescribed and actual sets pair BY
 * `setNumber` within the session — unpaired entries on either side are
 * ignored. A pair is scorable when the snapshot carries a floor + load, the
 * actual is completed with reps+weight, and the weight is ≥ the prescribed
 * load − epsilon (attempted lighter feeds the follow-down rule instead).
 * Null when nothing (policy-relevant) is scorable OR the quorum fails: no
 * evidence either way, never a stall from silence.
 */
export function sessionStall(
  session: AutoregSession,
  stallPolicy: AutoregStallPolicy,
): { missedSets: number; scorableSets: number; repFloor: number; loadKg: number } | null {
  if (stallPolicy === 'first-set') return firstSetStall(session)
  // FIXED mode also demands a rep floor on the snapshot — no floor, no verdict.
  const pairs = scorablePairs(session).filter(
    (p): p is ScorablePair & { repMin: number } => p.repMin !== null,
  )
  if (!meetsQuorum(pairs.length, session)) return null

  let missed = 0
  let heaviestMissed: { repFloor: number; loadKg: number } | null = null
  for (const pair of pairs) {
    if (pair.reps < pair.repMin) {
      missed += 1
      if (heaviestMissed === null || pair.loadKg > heaviestMissed.loadKg) {
        heaviestMissed = { repFloor: pair.repMin, loadKg: pair.loadKg }
      }
    }
  }

  if (heaviestMissed === null) return null
  return { missedSets: missed, scorableSets: pairs.length, ...heaviestMissed }
}

/**
 * Whether ONE session beat a rep top: every scorable working pair (the same
 * at-load pairing discipline as the stall rules) finished AT OR ABOVE
 * `repTop`, quorum-gated (M3). Null = no verdict (nothing scorable, or the
 * quorum failed) — silence over corruption. Exported for the weekly volume-
 * progression signal (lib/volume-progression.ts): "beat top of range" must
 * mean exactly what the engine means by scorable, or the two would disagree
 * about the same session.
 */
export function sessionBeatsTop(session: AutoregSession, repTop: number): boolean | null {
  const pairs = scorablePairs(session)
  if (!meetsQuorum(pairs.length, session)) return null
  return pairs.every((p) => p.reps >= repTop)
}

/** The heaviest scorable prescribed load of a session — the H2 streak scope:
 *  a fixed-mode stall streak only deepens while this is unchanged. */
function topPrescribedLoad(session: AutoregSession): number | null {
  const pairs = scorablePairs(session)
  if (pairs.length === 0) return null
  return pairs.reduce((a, b) => (b.loadKg > a.loadKg ? b : a)).loadKg
}

/** Every non-warmup prescribed load of the session, ε-deduped descending —
 *  the load-keyed cap basis for `applyAutoregToSets` (C2). */
function stalledLoads(session: AutoregSession, unit?: WeightUnit): number[] {
  const loads: number[] = []
  for (const plan of bySetNumber(session.prescribed).values()) {
    if (plan.setType === 'warmup' || plan.loadKg === null) continue
    loads.push(plan.loadKg)
  }
  return bucketLoads(loads, unit)
}

/** Builds the `'anchor'` verdict from outperform / null-load evidence. Null
 *  when nothing anchored. `evidence.loadKg` names the heaviest PRESCRIBED
 *  load when one exists, else the anchored performed load; anchors never
 *  suggest the early deload. */
function anchorVerdict(
  latest: AutoregSession,
  outperform: OutperformEvidence | null,
  nullAnchor: { count: number; anchorKg: number } | null,
  scorableSets: number,
  range?: AutoregAdjustment['range'],
  unit?: WeightUnit,
): AutoregAdjustment | null {
  const anchors: AutoregAnchor[] = [
    ...(nullAnchor ? [{ prescribedLoadKg: null, anchorKg: nullAnchor.anchorKg }] : []),
    ...(outperform?.buckets ?? []),
  ]
  if (anchors.length === 0) return null
  const anchor = outperform
    ? { fromLoadKg: outperform.fromLoadKg, toLoadKg: outperform.toLoadKg }
    : { fromLoadKg: null, toLoadKg: anchors[0].anchorKg }
  return {
    action: 'anchor',
    deltaKg: anchor.fromLoadKg === null ? 0 : anchor.toLoadKg - anchor.fromLoadKg,
    suggestEarlyDeload: false,
    stalledLoads: stalledLoads(latest, unit),
    anchorLoads: anchors,
    anchor,
    evidence: {
      missedSets: 0,
      scorableSets,
      repFloor: outperform?.repFloor ?? 0,
      loadKg: anchor.fromLoadKg ?? anchor.toLoadKg,
    },
    ...(range ? { range } : {}),
  }
}

/** A qualifying follow-down session (H1): every completed working attempt on
 *  a loaded prescription sat at ≤ 95% of plan WITH its floor met, none at
 *  load, and the lighter attempts meet the M3 quorum. Returns the lighter
 *  pairs, or null when the session doesn't qualify. */
function followDownPairs(session: AutoregSession): ScorablePair[] | null {
  const { atLoad, lighter } = workingPairs(session)
  if (atLoad.length > 0 || lighter.length === 0) return null
  if (!meetsQuorum(lighter.length, session)) return null
  for (const pair of lighter) {
    if (pair.repMin === null || pair.reps < pair.repMin) return null
  }
  return lighter
}

/** The follow-down verdict (H1): three consecutive COMPARABLE qualifying
 *  sessions (same ε-bucketed prescribed loads throughout) propose anchoring
 *  the working loads DOWN to the latest session's actually-used loads —
 *  matching the plan to reality. Null when the streak isn't there: one or
 *  two lighter sessions are their own streak class (not a stall, not
 *  no-evidence), just not yet a proposal. */
function followDownVerdict(
  window: readonly AutoregSession[],
  unit?: WeightUnit,
): AutoregAdjustment | null {
  if (window.length < STALLS_BEFORE_DECREMENT) return null
  const streak: ScorablePair[][] = []
  for (const session of window.slice(0, STALLS_BEFORE_DECREMENT)) {
    const pairs = followDownPairs(session)
    if (pairs === null) return null
    streak.push(pairs)
  }
  const loadsOf = (pairs: ScorablePair[]) =>
    bucketLoads(
      pairs.map((p) => p.loadKg),
      unit,
    )
  const reference = loadsOf(streak[0])
  for (const pairs of streak.slice(1)) {
    const loads = loadsOf(pairs)
    if (loads.length !== reference.length) return null
    if (loads.some((load, i) => !sameLoad(load, reference[i], unit))) return null
  }
  const latestPairs = streak[0]
  const buckets = anchorBuckets(latestPairs, unit)
  const top = buckets[0]
  const heaviest = latestPairs.reduce((a, b) => (b.loadKg > a.loadKg ? b : a))
  return {
    action: 'anchor',
    deltaKg: top.anchorKg - (top.prescribedLoadKg ?? 0),
    suggestEarlyDeload: false,
    stalledLoads: stalledLoads(window[0], unit),
    anchorLoads: buckets,
    anchor: { fromLoadKg: top.prescribedLoadKg, toLoadKg: top.anchorKg },
    evidence: {
      missedSets: 0,
      scorableSets: latestPairs.length,
      repFloor: heaviest.repMin ?? 0,
      loadKg: top.prescribedLoadKg ?? top.anchorKg,
    },
  }
}

/** Null-load anchor riding a NON-anchor verdict (stall/hold/fill): the
 *  loaded sets' verdict stands, but load-less sets with evidence still get
 *  their performed-load ghost. Spread into the adjustment. */
function anchorRider(
  nullAnchor: { count: number; anchorKg: number } | null,
): Pick<AutoregAdjustment, 'anchorLoads'> | Record<string, never> {
  return nullAnchor
    ? { anchorLoads: [{ prescribedLoadKg: null, anchorKg: nullAnchor.anchorKg }] }
    : {}
}

/**
 * The session-level anchor evidence ONE session testifies to, load-keyed
 * (C2), independent of any stall verdict: the outperform rule's buckets
 * (every scorable set ≥ prescribed × (1 + OUTPERFORM_FRACTION) with the rep
 * floor met — all-or-nothing) merged with the null-load-prescription anchor.
 * Exported so the plan-sync detector (lib/plan-sync.ts) and the derive
 * engine can never disagree about what counts as outperformed — one
 * implementation, one margin, one epsilon. NOTE: this is single-session
 * evidence; the two-session up-anchor confirmation (M2) is the CALLER's to
 * enforce across sessions.
 */
export function sessionAnchorLoads(session: AutoregSession, unit?: WeightUnit): AutoregAnchor[] {
  const nullAnchor = nullLoadAnchor(session)
  return [
    ...(nullAnchor ? [{ prescribedLoadKg: null, anchorKg: nullAnchor.anchorKg }] : []),
    ...(outperformAnchors(scorablePairs(session), unit)?.buckets ?? []),
  ]
}

/**
 * The Layer 1 FIXED-mode verdict for one exercise from its prior sessions.
 * Sessions are defensively re-sorted newest-first by `startedAtMs` (H6);
 * only the first `AUTOREG_SESSION_WINDOW` are consulted. Verdict order:
 * FOLLOW-DOWN (three comparable all-lighter sessions — H1) → OUTPERFORM
 * (two consecutive qualifying sessions — M2) → stall rules per the
 * program's `stallPolicy` ('all-sets': ANY floor miss stalls — C1;
 * 'first-set': only the governing set's miss stalls; one or two consecutive
 * stalls repeat the load; three AT THE SAME prescribed top load — H2 — back
 * off ~10% and suggest pulling the deload forward). Null-load sets with
 * completed working loads anchor regardless of the loaded verdict. All
 * verdicts are quorum-gated (M3) — under 'first-set' a STALL verdict's
 * quorum is the governing set's scorability itself; non-stall verdicts keep
 * the half-count quorum under either policy. Null = no adjustment (schemes
 * proceed untouched).
 */
export function autoregulate(
  incrementKg: number,
  sessions: readonly AutoregSession[],
  stallPolicy: AutoregStallPolicy,
  unit?: WeightUnit,
  overshootPolicy: OvershootPolicy = 'strict-load',
): AutoregAdjustment | null {
  const ordered = newestFirst(sessions)
  const window = creditSessions(ordered, overshootPolicy).slice(0, AUTOREG_SESSION_WINDOW)
  const latest = window[0]
  if (!latest) return null
  // Display-side recognition rides RAW facts — a credited view can't overshoot.
  const overshoot = ordered[0] ? sessionOvershoot(ordered[0]) : null
  const nullAnchor = nullLoadAnchor(latest)
  const pairs = scorablePairs(latest)

  if (pairs.length === 0) {
    const down = followDownVerdict(window, unit)
    if (down) return down
    if (nullAnchor && !meetsQuorum(nullAnchor.count, latest)) return null
    return anchorVerdict(latest, null, nullAnchor, 0, undefined, unit)
  }

  // The stall verdict carries its own policy-shaped quorum (sessionStall);
  // outperform / anchor verdicts keep the half-count M3 quorum under either
  // policy — the stall policy governs stall scoring only. Stall and
  // outperform are mutually exclusive (an outperform needs EVERY floor met,
  // a stall needs a governed floor missed), so checking the stall first
  // changes no all-sets verdict.
  const latestStall = sessionStall(latest, stallPolicy)
  if (!latestStall) {
    if (!meetsQuorum(pairs.length + (nullAnchor?.count ?? 0), latest)) return null
    const outperform = confirmedOutperform(outperformAnchors(pairs, unit), window, unit)
    if (outperform) return anchorVerdict(latest, outperform, nullAnchor, pairs.length, undefined, unit)
    return anchorVerdict(latest, null, nullAnchor, pairs.length, undefined, unit)
  }

  // H2: the streak only deepens while the prescribed top load is unchanged —
  // any change (including an applied back-off) starts a fresh streak, so a
  // decrement can never cascade straight into another decrement.
  const latestTop = topPrescribedLoad(latest)
  let consecutive = 1
  for (const session of window.slice(1)) {
    if (sessionStall(session, stallPolicy) === null) break
    const top = topPrescribedLoad(session)
    if (latestTop === null || top === null || !sameLoad(top, latestTop, unit)) break
    consecutive += 1
  }

  const shared = {
    stalledLoads: stalledLoads(latest, unit),
    ...anchorRider(nullAnchor),
    evidence: latestStall,
  }
  // Recognition rides EVERY verdict shape (#227): a repeat that would read
  // as a miss leads with the beat; a decrement keeps its (load-changing)
  // stall story in the reason line but still CARRIES the annotation, so an
  // e1RM-beating session never renders as pure "goal not met".
  return consecutive >= STALLS_BEFORE_DECREMENT
    ? {
        action: 'decrement' as const,
        deltaKg: -backoffKg(latestStall.loadKg, incrementKg),
        suggestEarlyDeload: true,
        ...shared,
        ...(overshoot ? { overshoot } : {}),
      }
    : {
        action: 'repeat' as const,
        deltaKg: 0,
        suggestEarlyDeload: false,
        ...shared,
        ...(overshoot ? { overshoot } : {}),
      }
}

/**
 * Total at-load working reps of two adjacent sessions over their SHARED
 * load frame: comparable only when both sessions' scorable prescribed loads
 * match pairwise within epsilon (sorted descending, same count) — "failing
 * to add reps" is only meaningful AT THE SAME PRESCRIBED LOADS, and load is
 * the only cross-session identity (C2). Null (not comparable — a rep-gain
 * verdict would be noise) resets the stall streak.
 */
function comparableTotals(
  current: AutoregSession,
  previous: AutoregSession,
  unit?: WeightUnit,
): { totalReps: number; prevTotalReps: number } | null {
  const currentPairs = scorablePairs(current)
  const previousPairs = scorablePairs(previous)
  if (currentPairs.length === 0 || currentPairs.length !== previousPairs.length) return null
  const currentLoads = currentPairs.map((p) => p.loadKg).sort((a, b) => b - a)
  const previousLoads = previousPairs.map((p) => p.loadKg).sort((a, b) => b - a)
  for (let i = 0; i < currentLoads.length; i++) {
    if (!sameLoad(currentLoads[i], previousLoads[i], unit)) return null
  }
  return {
    totalReps: currentPairs.reduce((sum, p) => sum + p.reps, 0),
    prevTotalReps: previousPairs.reduce((sum, p) => sum + p.reps, 0),
  }
}

/** Range classification of the latest session's pairs against TODAY's plan
 *  rows, order-free (C2): pairs and rows meet only through load buckets.
 *  Within a bucket, the best-performing pairs are optimistically matched to
 *  the ranged rows' tops (both sorted descending) and the rest score their
 *  own snapshot floors (H3) — with no per-set identity across sessions, the
 *  benefit of the doubt is the only honest assignment. */
function classifyRange(
  pairs: readonly ScorablePair[],
  rows: readonly AutoregRangeRow[],
  unit?: WeightUnit,
): {
  filled: boolean
  missedSets: number
  /** Sum of matched tops + fixed floors — the fill target for M1 (null when
   *  any pair is ungoverned, i.e. the target is unconfirmable). */
  fillTotal: number | null
  /** The top governing the heaviest pair (0 = none). */
  topForHeaviest: number
} {
  const loadedRows = rows.filter(
    (r): r is { loadKg: number; repMax: number | null } => r.loadKg !== null,
  )
  const heaviestPair = pairs.reduce((a, b) => (b.loadKg > a.loadKg ? b : a))

  // Fast path — every row ranged at one uniform top (the overwhelmingly
  // common template): every pair scores that top, no load matching needed
  // (and no sensitivity to week-over-week scheme-load drift).
  const tops = rows.map((r) => r.repMax)
  if (rows.length > 0 && tops.every((t) => t !== null && t === tops[0])) {
    const top = tops[0] as number
    const missed = pairs.filter((p) => p.reps < top).length
    return {
      filled: pairs.length > 0 && missed === 0,
      missedSets: missed,
      fillTotal: top * pairs.length,
      topForHeaviest: top,
    }
  }

  // Heterogeneous / mixed (H3): bucket rows by load, govern each pair by the
  // SMALLEST row bucket at/above its prescribed load (scheme loads only ever
  // drift up from the held snapshot loads).
  const rowBucketLoads = bucketLoads(
    loadedRows.map((r) => r.loadKg),
    unit,
  )
  const governing = (loadKg: number): number | undefined => {
    let best: number | undefined
    for (const x of rowBucketLoads) {
      if (
        (x >= loadKg - LOAD_EPSILON_KG || sameLoad(x, loadKg, unit)) &&
        (best === undefined || x < best)
      ) {
        best = x
      }
    }
    return best
  }

  let filled = pairs.length > 0
  let missedSets = 0
  let fillTotal: number | null = 0
  let topForHeaviest = 0
  for (const bucketLoad of rowBucketLoads) {
    const bucketTops = loadedRows
      .filter((r) => sameLoad(r.loadKg, bucketLoad, unit) && r.repMax !== null)
      .map((r) => r.repMax as number)
      .sort((a, b) => b - a)
    const bucketPairs = pairs
      .filter((p) => governing(p.loadKg) === bucketLoad)
      .sort((a, b) => b.reps - a.reps)
    if (bucketPairs.length < bucketTops.length) filled = false
    // Heterogeneous tops within one bucket (verification re-break of H3):
    // which historical set owned which top is unknowable order-free, and the
    // optimistic best-reps→highest-top match can launder a top-target miss
    // into a fill. Misses stay optimistic — only CERTAIN misses stall — but
    // a fill is unconfirmable here: a mixed-top bucket can never step.
    if (new Set(bucketTops).size > 1) filled = false
    for (const [i, pair] of bucketPairs.entries()) {
      const top = bucketTops[i]
      if (top !== undefined) {
        // Ranged-class: matched to a top, best reps against highest top.
        if (pair.reps < top) {
          filled = false
          missedSets += 1
        }
        if (fillTotal !== null) fillTotal += top
        if (pair === heaviestPair) topForHeaviest = top
      } else {
        // Fixed-class (H3): floor scoring only — a fixed row never blocks
        // the range verdict beyond its own floor.
        if (pair.repMin !== null && pair.reps < pair.repMin) {
          filled = false
          missedSets += 1
        }
        if (fillTotal !== null) fillTotal += pair.repMin ?? 0
      }
    }
  }
  for (const pair of pairs) {
    if (governing(pair.loadKg) === undefined) {
      // Ungoverned: no row at/above this load — the fill target is
      // unconfirmable for this pair (renumbered/resized template).
      filled = false
      fillTotal = null
      if (pair.repMin !== null && pair.reps < pair.repMin) missedSets += 1
    }
  }
  return { filled, missedSets, fillTotal, topForHeaviest }
}

/**
 * The RANGE-mode (double progression) verdict for one exercise. Sessions are
 * defensively re-sorted newest-first (H6); only the first
 * `AUTOREG_RANGE_SESSION_WINDOW` are consulted.
 *
 * `rangeRows` is the CURRENT plan's scheme-derived WORKING rows —
 * deliberately plan PARAMETERS, not snapshotted facts: the top defines the
 * goal the lifter is climbing toward, while the evidence scored against it
 * (prescribed loads, logged reps) stays snapshot-only. Rows with a null
 * `repMax` are FIXED rows in a mixed template (H3): they join floor scoring
 * only and never disable range protection for the ranged rows. See the
 * snapshot note in db/programs.ts.
 *
 * Verdict order: FOLLOW-DOWN (H1) → FILL (every ranged row's top confirmed
 * and fixed rows at their floors → step; a CONFIRMED outperformed fill
 * composes the step onto the performed loads) → OUTPERFORM (two consecutive
 * qualifying sessions — M2) → STALL ×3 (three consecutive no-total-gain
 * session pairs at the same prescribed loads; a flat streak within one rep
 * of the fill target HOLDs instead of decrementing — M1) → HOLD (cap at the
 * latest prescribed loads). Null-load sets with completed working loads
 * anchor regardless of the loaded verdict. All verdicts are quorum-gated
 * (M3). Null when nothing is scorable and nothing anchors — silence over
 * corruption, as ever.
 */
export function autoregulateRange(
  stepKg: number,
  sessions: readonly AutoregSession[],
  rangeRows: readonly AutoregRangeRow[],
  unit?: WeightUnit,
  overshootPolicy: OvershootPolicy = 'strict-load',
): AutoregAdjustment | null {
  const ordered = newestFirst(sessions)
  const window = creditSessions(ordered, overshootPolicy).slice(0, AUTOREG_RANGE_SESSION_WINDOW)
  const latest = window[0]
  if (!latest) return null
  // Display-side recognition rides RAW facts — a credited view can't overshoot.
  const overshoot = ordered[0] ? sessionOvershoot(ordered[0]) : null
  const nullAnchor = nullLoadAnchor(latest)
  const pairs = scorablePairs(latest)
  if (pairs.length === 0) {
    const down = followDownVerdict(window, unit)
    if (down) return down
    if (nullAnchor && !meetsQuorum(nullAnchor.count, latest)) return null
    return anchorVerdict(latest, null, nullAnchor, 0, undefined, unit)
  }
  if (!meetsQuorum(pairs.length + (nullAnchor?.count ?? 0), latest)) return null

  const heaviest = pairs.reduce((a, b) => (b.loadKg > a.loadKg ? b : a))
  const classified = classifyRange(pairs, rangeRows, unit)
  const evidence = {
    missedSets: classified.missedSets,
    scorableSets: pairs.length,
    repFloor: classified.topForHeaviest,
    loadKg: heaviest.loadKg,
  }

  let stalls = 0
  for (let i = 0; i + 1 < window.length; i++) {
    const totals = comparableTotals(window[i], window[i + 1], unit)
    if (totals === null || totals.totalReps > totals.prevTotalReps) break
    stalls += 1
  }

  const latestTotals = window[1] ? comparableTotals(latest, window[1], unit) : null
  const latestTotal = pairs.reduce((sum, p) => sum + p.reps, 0)
  const range = {
    totalReps: latestTotals?.totalReps ?? latestTotal,
    prevTotalReps: latestTotals?.prevTotalReps ?? null,
    stalls,
  }
  const outperform = confirmedOutperform(outperformAnchors(pairs, unit), window, unit)
  const shared = {
    stalledLoads: stalledLoads(latest, unit),
    ...anchorRider(nullAnchor),
    evidence,
    range,
  }
  if (classified.filled) {
    return {
      action: 'step',
      deltaKg: stepKg,
      suggestEarlyDeload: false,
      ...shared,
      // A CONFIRMED outperformed fill steps FROM the performed loads: the
      // anchors ride the step (composition, not competition) and the reason
      // line names the performed load as the fill load.
      ...(outperform
        ? {
            anchorLoads: [
              ...(nullAnchor
                ? [{ prescribedLoadKg: null, anchorKg: nullAnchor.anchorKg }]
                : []),
              ...outperform.buckets,
            ],
            anchor: { fromLoadKg: outperform.fromLoadKg, toLoadKg: outperform.toLoadKg },
          }
        : {}),
    }
  }
  if (outperform) return anchorVerdict(latest, outperform, nullAnchor, pairs.length, range, unit)
  if (stalls >= STALLS_BEFORE_DECREMENT) {
    // M1: a flat streak parked within one rep of the fill target is the
    // model densifying, not failing — HOLD; nobody cuts 10% off 35/36 reps.
    const nearFill = classified.fillTotal !== null && latestTotal >= classified.fillTotal - 1
    if (!nearFill) {
      return {
        action: 'decrement',
        deltaKg: -backoffKg(evidence.loadKg, stepKg),
        suggestEarlyDeload: true,
        ...shared,
        // Recognition rides decrements too (#227) — same contract as fixed
        // mode: the reason keeps its stall story, the annotation carries the
        // beat so it never renders as pure "goal not met".
        ...(overshoot ? { overshoot } : {}),
      }
    }
  }
  return {
    action: 'repeat',
    deltaKg: 0,
    suggestEarlyDeload: false,
    ...shared,
    // Recognition on holds (#227) — same contract as fixed mode.
    ...(overshoot ? { overshoot } : {}),
  }
}

/**
 * The ANCHOR-only rule set for schemes whose prescriptions can carry no load
 * (rpe-target before an e1RM exists, null-base weekly-volume /
 * rep-progression): the latest session's null-load working sets with
 * completed loads anchor at the performed load — the weight ghost those
 * exercises never had. LOADED sets are deliberately left to their scheme
 * (rpe-target self-corrects through the e1RM). Quorum-gated (M3); sessions
 * defensively re-sorted newest-first (H6).
 */
export function autoregulateAnchor(
  sessions: readonly AutoregSession[],
  unit?: WeightUnit,
): AutoregAdjustment | null {
  const latest = newestFirst(sessions)[0]
  if (!latest) return null
  const nullAnchor = nullLoadAnchor(latest)
  if (nullAnchor && !meetsQuorum(nullAnchor.count, latest)) return null
  return anchorVerdict(latest, null, nullAnchor, 0, undefined, unit)
}

/**
 * The EARLY-DELOAD-FLAG rule set (M4) for schemes that own their loads
 * (percent-1rm's static training max, amrap-cycle's wave): floor-only stall
 * scoring drives `suggestEarlyDeload` ONLY — never a load adjustment. Three
 * consecutive stalled sessions (floor scoring per the program's stall
 * policy — the same `sessionStall` the fixed rules use, so 'first-set'
 * flags only on the governing set's misses; quorum-gated per session — M3)
 * flag "training max likely set too high" (5/3/1's failed-cycle rule). No
 * H2 load-scoping: these schemes legitimately change loads every week, so
 * the streak is session-based. Null below the streak — either way the
 * scheme's loads proceed untouched (`applyAutoregToSets` passes every set
 * through on a `'flag'` verdict).
 */
export function autoregulateEarlyDeload(
  sessions: readonly AutoregSession[],
  stallPolicy: AutoregStallPolicy,
  overshootPolicy: OvershootPolicy = 'strict-load',
): AutoregAdjustment | null {
  // Crediting can SILENCE the advisory flag (a policy-met session is no
  // stall) but the mode's contract holds under every policy: 'flag' only,
  // deltaKg 0 — a credited overshoot never touches the scheme's TM math.
  const window = creditSessions(newestFirst(sessions), overshootPolicy).slice(
    0,
    AUTOREG_SESSION_WINDOW,
  )
  if (window.length < STALLS_BEFORE_DECREMENT) return null
  const stallEvidence = window
    .slice(0, STALLS_BEFORE_DECREMENT)
    .map((session) => sessionStall(session, stallPolicy))
  const latestStall = stallEvidence[0]
  if (!latestStall || stallEvidence.some((s) => s === null)) return null
  return {
    action: 'flag',
    deltaKg: 0,
    suggestEarlyDeload: true,
    stalledLoads: [],
    evidence: latestStall,
  }
}

/**
 * Diet-phase gate over a finished verdict (pure, applied by the derive layer
 * AFTER the rule sets ran — verdict MATH is never phase-aware). Only
 * 'cutting' does anything; null / 'maintaining' / 'bulking' return the input
 * IDENTITY (===), which is the byte-identity guarantee for phase-less
 * programs. Under 'cutting':
 * - a 'decrement' (H2's third-stall auto-backoff, fixed or range) is HELD:
 *   the applied action becomes a repeat at the stalled load, the would-be
 *   backoff rides along as `heldBackoffKg` so the reactive-proposal path can
 *   offer it as the confirmable action (decline = hold), and
 *   `suggestEarlyDeload` stays true — annotate, never suppress;
 * - 'repeat' and 'flag' verdicts keep their action and gain the
 *   `phaseContext` annotation (the copy reframes: stalls are expected while
 *   cutting, holding is the win);
 * - 'step' / 'anchor' verdicts pass through untouched — progress is progress
 *   in any phase, and an anchor mirrors what the lifter already did.
 * Loads never change BECAUSE of a phase; only the auto-application of a cut
 * gates. Null in, null out.
 */
export function applyDietPhaseToAdjustment(
  adjustment: AutoregAdjustment | null,
  phase: DietPhase | null,
): AutoregAdjustment | null {
  if (adjustment === null || phase !== 'cutting') return adjustment
  if (adjustment.action === 'decrement') {
    return {
      ...adjustment,
      action: 'repeat',
      deltaKg: 0,
      phaseContext: 'cutting',
      heldBackoffKg: -adjustment.deltaKg,
    }
  }
  if (adjustment.action === 'repeat' || adjustment.action === 'flag') {
    return { ...adjustment, phaseContext: 'cutting' }
  }
  return adjustment
}

/**
 * Applies a Layer 1 adjustment to a week's scheme-derived sets, BEFORE
 * overrides (override > autoreg — the caller merges overrides on top and they
 * replace both the load and the stamp). Evidence is LOAD-KEYED (C2): each
 * non-warmup scheme set at load L is capped against the largest evidence
 * load X with L ≥ X − ε — its own bucket — so a stalled set can't escape
 * its cap through renumbering, a genuinely new lighter set (below every
 * evidence load) is untouched, and foreign evidence can't slash an unrelated
 * set. On decrement every cap scales by the evidence set's back-off
 * fraction. On repeat/decrement loads are never raised (a scheme already
 * below its cap keeps its own load); a range-mode STEP is the one deliberate
 * exception — the prescription becomes exactly the bucket load + stepKg.
 * Anchored buckets are prescribed exactly their anchor load — the one path
 * that may write a load onto a load-less scheme set — with a fill's step
 * composing on top for confirmed-outperform buckets. A `'flag'` verdict
 * (M4) adjusts nothing. Adjusted sets keep their pre-autoreg value in
 * `schemeLoadKg` (null for load-less sets) so surfaces can offer "use plan
 * as written". Scoring (the verdict) remains working-sets-only —
 * backoff/amrap sets are only FROZEN here (or stepped uniformly) so volume
 * work can't climb past a frozen top set.
 */
export function applyAutoregToSets(
  sets: readonly DerivedSet[],
  adjustment: AutoregAdjustment,
  unit?: WeightUnit,
): DerivedSet[] {
  if (adjustment.action === 'flag') return [...sets]
  const fraction =
    adjustment.evidence.loadKg > 0
      ? (adjustment.evidence.loadKg + adjustment.deltaKg) / adjustment.evidence.loadKg
      : 1
  return sets.map((set) => {
    if (set.setType === 'warmup' || set.derivedFrom !== 'scheme') return set
    const anchorKg = anchorLoadFor(adjustment.anchorLoads, set.loadKg, unit)
    if (anchorKg !== undefined) {
      // Anchored: the bucket load IS the prescription — exactly, up or down —
      // and the ONE path allowed to stamp a load onto a load-less scheme set.
      // A `step` composes on top when the set also belongs to a prescribed-
      // at-fill bucket (confirmed outperformed fill).
      const stepsFromAnchor =
        adjustment.action === 'step' &&
        set.loadKg !== null &&
        evidenceLoadFor(adjustment.stalledLoads, set.loadKg, unit) !== undefined
      return {
        ...set,
        loadKg: stepsFromAnchor ? anchorKg + adjustment.deltaKg : anchorKg,
        derivedFrom: 'autoreg' as const,
        schemeLoadKg: set.loadKg,
      }
    }
    // An anchor verdict adjusts ONLY its anchored buckets: sets below every
    // bucket (skipped, incomplete, attempted-at-plan sets on a loaded day)
    // carry no evidence and stay exactly as the scheme derived them.
    if (adjustment.action === 'anchor') return set
    if (set.loadKg === null) return set
    const stalledLoadKg = evidenceLoadFor(adjustment.stalledLoads, set.loadKg, unit)
    if (stalledLoadKg === undefined) return set
    // Decrement scales each cap proportionally (the evidence set's back-off
    // fraction); a step adds the absolute increment, like the scheme would.
    const targetKg = Math.max(
      0,
      adjustment.action === 'step' ? stalledLoadKg + adjustment.deltaKg : stalledLoadKg * fraction,
    )
    return {
      ...set,
      loadKg: adjustment.action === 'step' ? targetKg : Math.min(set.loadKg, targetKg),
      derivedFrom: 'autoreg',
      schemeLoadKg: set.loadKg,
    }
  })
}

/**
 * Stamps a decrement verdict with the landing load the application ACTUALLY
 * produced, so `autoregReason`'s "Drop to X" and the prescription can never
 * diverge. The reason's evidence names the heaviest MISSED load, so X must
 * be the adjusted landing load of that EVIDENCE bucket — the set whose
 * pre-adjustment scheme load matches `evidence.loadKg` (ε-or-increment
 * identity, same `loadsMatch` tolerance as scoring). In a multi-load session
 * the heaviest ADJUSTED set can belong to a PASSING bucket (top 100 kg held,
 * back-off 80 kg stalling → "Drop to 91.25 — stalled at 80" is not a drop);
 * the fallback to the heaviest adjusted working load fires only when no set
 * matches the evidence bucket (mid-cycle edits can orphan it). Verdict
 * unchanged when nothing was adjusted. Callers pass the sets AFTER per-set
 * quantization (`quantizeAdjustedLoadKg`) so the stamp is the number that
 * actually lands on the plan.
 */
export function stampAppliedLoad(
  adjustment: AutoregAdjustment,
  sets: readonly DerivedSet[],
  unit?: WeightUnit,
): AutoregAdjustment {
  let evidenceTop: number | null = null
  let top: number | null = null
  for (const set of sets) {
    if (set.setType === 'warmup' || set.derivedFrom !== 'autoreg' || set.loadKg === null) continue
    if (top === null || set.loadKg > top) top = set.loadKg
    if (set.schemeLoadKg != null && sameLoad(set.schemeLoadKg, adjustment.evidence.loadKg, unit)) {
      if (evidenceTop === null || set.loadKg > evidenceTop) evidenceTop = set.loadKg
    }
  }
  const applied = evidenceTop ?? top
  return applied === null ? adjustment : { ...adjustment, appliedLoadKg: applied }
}

/**
 * The lifter-facing reason line — every adjustment ships one (the PRD's
 * transparency contract). Display unit applied here, not in the engine.
 * Voice bar (#228): imperative, what-to-do-and-why, the lifter's actual
 * quantized numbers, zero engine vocabulary ("range", "load steps",
 * "anchor", "quorum").
 *   Fixed:  "Stay at 100 kg — get 8 reps on all 3 sets (2 came up short)"
 *           "Drop to 90 kg — stalled at 100 kg 3 sessions straight (~10% off)"
 *   Range:  "Move up to 102.5 kg — you hit the top reps on every set at 100 kg"
 *           "Stay at 100 kg — hit 12 reps on every set, then the weight goes up"
 *           "Stay at 100 kg — no new reps yet (24 vs 24); add reps and the
 *            weight goes up"
 *           "Drop to 90 kg — no new reps at 100 kg for 3 straight sessions ..."
 *   Anchor: "Work at 120 kg — you lifted it over the planned 100 kg; the plan
 *            follows you"
 *           "Work at 90 kg — that's where you worked for 3 straight sessions,
 *            not the planned 100 kg" (follow-down, H1)
 *           "Start at 120 kg — what you lifted last session"
 *   Flag:   "Lower the training max — 3 straight stalls at 100 kg say it's
 *            set too high" (M4 — 5/3/1's failed-cycle rule)
 * An outperformed fill's step line speaks from the PERFORMED load (the
 * anchor bucket), matching where `applyAutoregToSets` actually lands the step.
 */
export function autoregReason(adjustment: AutoregAdjustment, unit: WeightUnit): string {
  const load = `${quantizeDisplayLoad(adjustment.evidence.loadKg, unit)} ${unit}`
  // A decrement's landing load: the derive layer stamps the APPLIED per-set
  // result (`appliedLoadKg`) so "Drop to X" always names the prescription
  // that actually landed. The fallback (raw engine verdicts) recomputes with
  // the SAME anti-fixed-point quantization the application path uses (#226),
  // so a light-load ~10% backoff can never claim the stalled load itself.
  const droppedKg = () =>
    adjustment.appliedLoadKg ??
    quantizeAdjustedLoadKg(
      adjustment.evidence.loadKg + adjustment.deltaKg,
      adjustment.evidence.loadKg,
      unit,
    )
  const droppedTo = () => `${kgToDisplay(droppedKg(), unit)} ${unit}`
  // Floor-pinned decrement (#228): the one-increment floor made the cut a
  // no-op — the applied load quantizes back onto the evidence load. "Drop to
  // X — stalled at X" would phrase changing nothing as a change; hold voice
  // is the honest rendering.
  const pinnedAtFloor = () =>
    quantizeDisplayLoad(droppedKg(), unit) ===
    quantizeDisplayLoad(adjustment.evidence.loadKg, unit)
  // Cutting framing (honest copy rule: stalls are EXPECTED under a deficit
  // and holding is the win — never a claim that cutting impairs strength).
  // One sentence owns every cutting-annotated 3-stall verdict: the M4 flag
  // and the held H2 backoff alike.
  if (adjustment.phaseContext === 'cutting' && adjustment.suggestEarlyDeload) {
    return `Hold ${load} — 3 stalls is expected while cutting and holding is the win. Deload only if sessions feel grindy`
  }
  // Effort-gate sentences (one each — the annotation IS the story).
  if (adjustment.effortContext === 'overshoot') {
    return `Stay at ${load} — reps are there but the top set ran hot`
  }
  if (adjustment.effortContext === 'trend-veto') {
    return `Stay at ${load} — third stall, but your e1RM is rising; no backoff yet`
  }
  // Overshoot recognition (#227): a HOLD whose evidence would read as a miss
  // while the lifter beat the prescription's e1RM leads with the beat —
  // "goal not met" over a higher-e1RM performance is a display lie.
  if (adjustment.overshoot && adjustment.action === 'repeat') {
    const o = adjustment.overshoot
    const done = `${o.reps} × ${quantizeDisplayLoad(o.weightKg, unit)} ${unit}`
    const target = `${o.targetReps} × ${quantizeDisplayLoad(o.targetLoadKg, unit)} ${unit}`
    return `Beat the target — ${done} tops ${target} — holding the load`
  }
  if (adjustment.action === 'flag') {
    return `Lower the training max — 3 straight stalls at ${load} say it's set too high`
  }
  if (adjustment.action === 'anchor' && adjustment.anchor) {
    const to = `${quantizeDisplayLoad(adjustment.anchor.toLoadKg, unit)} ${unit}`
    if (adjustment.anchor.fromLoadKg === null) {
      return `Start at ${to} — what you lifted last session`
    }
    const from = `${quantizeDisplayLoad(adjustment.anchor.fromLoadKg, unit)} ${unit}`
    if (adjustment.anchor.toLoadKg < adjustment.anchor.fromLoadKg - LOAD_EPSILON_KG) {
      return `Work at ${to} — that's where you worked for ${STALLS_BEFORE_DECREMENT} straight sessions, not the planned ${from}`
    }
    return `Work at ${to} — you lifted it over the planned ${from}; the plan follows you`
  }
  if (adjustment.action === 'step') {
    const fillKg = adjustment.anchor?.toLoadKg ?? adjustment.evidence.loadKg
    const fill = `${quantizeDisplayLoad(fillKg, unit)} ${unit}`
    const next = `${quantizeDisplayLoad(fillKg + adjustment.deltaKg, unit)} ${unit}`
    return `Move up to ${next} — you hit the top reps on every set at ${fill}`
  }
  if (adjustment.range) {
    const { totalReps, prevTotalReps, stalls } = adjustment.range
    if (adjustment.action === 'decrement') {
      if (pinnedAtFloor()) {
        return `Stay at ${load} — no new reps for ${stalls} straight sessions (already at the smallest load)`
      }
      return `Drop to ${droppedTo()} — no new reps at ${load} for ${stalls} straight sessions (~10% off)`
    }
    const cutting = adjustment.phaseContext === 'cutting' ? ' (expected while cutting)' : ''
    return stalls > 0 && prevTotalReps !== null
      ? `Stay at ${load} — no new reps yet (${totalReps} vs ${prevTotalReps}); add reps and the weight goes up${cutting}`
      : `${repFillHoldReason(load, adjustment.evidence.repFloor)}${cutting}`
  }
  if (adjustment.action === 'decrement') {
    if (pinnedAtFloor()) {
      return `Stay at ${load} — stalled 3 sessions straight (already at the smallest load)`
    }
    return `Drop to ${droppedTo()} — stalled at ${load} 3 sessions straight (~10% off)`
  }
  const { missedSets, scorableSets, repFloor } = adjustment.evidence
  const cutting = adjustment.phaseContext === 'cutting' ? ' (expected while cutting)' : ''
  return `Stay at ${load} — get ${repFloor} reps on all ${scorableSets} sets (${missedSets} came up short)${cutting}`
}
