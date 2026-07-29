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
 * Scope — two progression models:
 * - FIXED (v1, `autoregulate`): the `linear` scheme with fixed-rep
 *   prescriptions. Stall = missing the rep floor; repeat, then back off after
 *   three consecutive stalls.
 * - RANGE (v2, `autoregulateRange`): double progression for rep-range
 *   prescriptions (repMin < repMax) — the `linear` scheme with ranged sets
 *   and the `double-progression` scheme. Add reps at the same load until
 *   every working set fills the range top, then step the load; a stall is a
 *   session failing to ADD total reps vs the previous session at the same
 *   prescribed load (NOT missing repMin — under a range, low reps early in
 *   the climb are the model working).
 * Both modes additionally run the OUTPERFORM rule (`'anchor'`): when the
 * latest session was performed meaningfully ABOVE its prescribed loads on
 * every scorable working set (floor met), the next derive anchors each set at
 * its performed load — the program follows the lifter up, not just down.
 * Load-less prescriptions (`autoregulateAnchor` for rpe-target etc., and
 * null-load sets inside either mode) anchor at the performed load with no
 * margin: any completed working load is more signal than no prescription.
 *
 * Explicitly out (future work): percent-1rm's stall behavior is NOT
 * self-correcting (its trainingMax is static); amrap-cycle bumps its
 * trainingMax unconditionally per completed wave; rpe-target derives from
 * e1RM and genuinely self-corrects once an e1RM exists (which is why its
 * LOADED sets are left to the scheme — only its load-less sets anchor).
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
  action: 'repeat' | 'decrement' | 'step' | 'anchor'
  /** Relative to the evidence load (`evidence.loadKg`): 0 (repeat),
   *  −backoffKg (escalated back-off), +stepKg (range filled), or the
   *  heaviest set's performed-minus-prescribed margin (anchor; per-set
   *  deltas live in `anchorLoadBySetNumber`) — see `applyAutoregToSets`. */
  deltaKg: number
  /** Three consecutive stalls: worth pulling the deload forward. */
  suggestEarlyDeload: boolean
  /** Prescribed-at-stall load per setNumber from the latest stalled session,
   *  every non-warmup set with a load — each next-week set is capped against
   *  ITS OWN entry (a passing top set is never slashed because a lighter
   *  volume set failed), and backoff/amrap volume work is frozen so it can't
   *  climb past a frozen top set. */
  stalledLoadBySetNumber: Readonly<Record<number, number>>
  /** Performed-load anchors per setNumber from the LATEST session: outperform
   *  evidence (every scorable set ≥ prescribed × 1.05, floor met) and/or
   *  null-load-prescription sets with a completed working load. Anchored sets
   *  are prescribed EXACTLY this load next derive; on a `step` verdict the
   *  step composes ON TOP of an anchored set's performed load (an outperformed
   *  fill steps from what the lifter actually lifted, not the out-run plan).
   *  Sets absent here anchor nothing — silence over corruption, per set. */
  anchorLoadBySetNumber?: Readonly<Record<number, number>>
  /** Reason-line evidence for anchors, present only when an outperform anchor
   *  rides the verdict (`fromLoadKg` = heaviest set's prescribed load) or the
   *  verdict IS a pure anchor (`fromLoadKg` null = the heaviest anchored set
   *  had no prescribed load at all). */
  anchor?: {
    fromLoadKg: number | null
    toLoadKg: number
  }
  /** Structured evidence for the reason line — formatting is display-side.
   *  Fixed mode: `repFloor`/`loadKg` name the HEAVIEST missed set. Range
   *  mode: `loadKg` is the heaviest scorable prescribed load, `repFloor` the
   *  range top governing that set (0 when the current plan carries no top for
   *  it), `missedSets` the sets still under their tops. */
  evidence: {
    missedSets: number
    scorableSets: number
    repFloor: number
    loadKg: number
  }
  /** Present ONLY on range-mode (double progression) verdicts. Totals sum
   *  at-load working reps over sets paired with the prior comparable session
   *  (`prevTotalReps` null when no comparable prior session exists). */
  range?: {
    totalReps: number
    prevTotalReps: number | null
    /** Consecutive no-rep-gain sessions ending at the latest one. */
    stalls: number
  }
}

/** Attempted-at-load tolerance. 0.05 kg absorbs lb→kg round-trip drift (an
 *  executed sweep showed stored-vs-prescribed drift up to 0.02 kg; the prior
 *  0.011 excluded ~17% of legitimate at-load attempts) while micro-loading
 *  noise still can't hide a stall. */
const LOAD_EPSILON_KG = 0.05

/** Outperform margin: performed must beat prescribed by ≥5% on EVERY scorable
 *  set before the program follows the lifter up — micro-loading past the plan
 *  is the scheme's job, a deliberate jump (120 done vs 80 planned) is not.
 *  The comparison keeps the same epsilon discipline as at-load pairing. */
const OUTPERFORM_FRACTION = 0.05

/** Consecutive stalled sessions required before the load is decremented
 *  (StrongLifts' cited rule: deload after the THIRD failed session). */
const STALLS_BEFORE_DECREMENT = 3

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

/** One scorable prescribed↔actual working pair (the shared evidence-quality
 *  rules): paired by setNumber, snapshot carries a load, the actual is
 *  completed with reps+weight, and the weight is ≥ the prescribed load −
 *  epsilon (attempted lighter = self-regulation already happened). `repMin`
 *  rides along nullable — FIXED mode additionally requires it. */
interface ScorablePair {
  setNumber: number
  loadKg: number
  repMin: number | null
  reps: number
  /** Performed load — the outperform rule's anchor candidate. */
  weightKg: number
}

function scorablePairs(session: AutoregSession): ScorablePair[] {
  const actualByNumber = bySetNumber(session.actual.filter((set) => isWorking(set.setType)))
  const pairs: ScorablePair[] = []
  for (const plan of bySetNumber(session.prescribed.filter((s) => isWorking(s.setType))).values()) {
    if (plan.loadKg === null) continue
    const done = actualByNumber.get(plan.setNumber)
    if (!done?.completed || done.reps === null || done.weightKg === null) continue
    if (done.weightKg < plan.loadKg - LOAD_EPSILON_KG) continue
    pairs.push({
      setNumber: plan.setNumber,
      loadKg: plan.loadKg,
      repMin: plan.repMin,
      reps: done.reps,
      weightKg: done.weightKg,
    })
  }
  return pairs
}

/** Performed-load anchors for the session's NULL-load prescriptions: a
 *  prescribed working set whose snapshot carries no load, paired (by
 *  setNumber) with a completed working actual holding reps + a positive
 *  weight, anchors at that weight. Same evidence-quality rules as
 *  `scorablePairs` minus the load comparison (there is nothing to compare —
 *  which is exactly why the performed load becomes the prescription).
 *  A null `repMin` alongside the null load means NO snapshot at all
 *  (pre-migration history, ad-hoc adds) rather than a snapshot that says
 *  "no load" — cold-start silence, never an anchor from a missing fact. */
function nullLoadAnchors(session: AutoregSession): Record<number, number> {
  const actualByNumber = bySetNumber(session.actual.filter((set) => isWorking(set.setType)))
  const anchors: Record<number, number> = {}
  for (const plan of bySetNumber(session.prescribed.filter((s) => isWorking(s.setType))).values()) {
    if (plan.loadKg !== null || plan.repMin === null) continue
    const done = actualByNumber.get(plan.setNumber)
    if (!done?.completed || done.reps === null || done.weightKg === null) continue
    if (done.weightKg <= 0) continue
    anchors[plan.setNumber] = done.weightKg
  }
  return anchors
}

interface OutperformEvidence {
  /** Performed load per outperforming setNumber. */
  bySetNumber: Record<number, number>
  /** Heaviest-set (by prescribed load) evidence, per the engine's convention. */
  fromLoadKg: number
  toLoadKg: number
  repFloor: number
}

/** The outperform verdict for one session's scorable pairs: EVERY pair must
 *  carry a positive prescribed load, a known rep floor the lifter met, and a
 *  performed load ≥ prescribed × 1.05 (epsilon-tolerant). All-or-nothing by
 *  design — one set at plan (or one ambiguous snapshot) means the session
 *  does not testify to a deliberate jump, and outperforming load while
 *  missing reps is NOT an outperform. Null = no anchor. */
function outperformAnchors(pairs: readonly ScorablePair[]): OutperformEvidence | null {
  if (pairs.length === 0) return null
  const bySetNumber: Record<number, number> = {}
  for (const pair of pairs) {
    if (pair.loadKg <= 0 || pair.repMin === null || pair.reps < pair.repMin) return null
    if (pair.weightKg < pair.loadKg * (1 + OUTPERFORM_FRACTION) - LOAD_EPSILON_KG) return null
    bySetNumber[pair.setNumber] = pair.weightKg
  }
  const heaviest = pairs.reduce((a, b) => (b.loadKg > a.loadKg ? b : a))
  return {
    bySetNumber,
    fromLoadKg: heaviest.loadKg,
    toLoadKg: heaviest.weightKg,
    repFloor: heaviest.repMin ?? 0,
  }
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
  // FIXED mode also demands a rep floor on the snapshot — no floor, no verdict.
  const pairs = scorablePairs(session).filter(
    (p): p is ScorablePair & { repMin: number } => p.repMin !== null,
  )

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

  if (pairs.length === 0 || heaviestMissed === null) return null
  return missed * 2 >= pairs.length
    ? { missedSets: missed, scorableSets: pairs.length, ...heaviestMissed }
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

/** Builds the `'anchor'` verdict from outperform and/or null-load evidence.
 *  Null when nothing anchored. `scorableSets` is the loaded-pair count (the
 *  anchored-set count is `anchorLoadBySetNumber`'s size); `evidence.loadKg`
 *  names the heaviest PRESCRIBED load when one exists, else the heaviest
 *  anchored performed load; anchors never suggest the early deload. */
function anchorVerdict(
  latest: AutoregSession,
  outperform: OutperformEvidence | null,
  nullAnchors: Record<number, number>,
  scorableSets: number,
  range?: AutoregAdjustment['range'],
): AutoregAdjustment | null {
  const bySetNumber = { ...nullAnchors, ...(outperform?.bySetNumber ?? {}) }
  if (Object.keys(bySetNumber).length === 0) return null
  const anchor = outperform
    ? { fromLoadKg: outperform.fromLoadKg, toLoadKg: outperform.toLoadKg }
    : { fromLoadKg: null, toLoadKg: Math.max(...Object.values(nullAnchors)) }
  return {
    action: 'anchor',
    deltaKg: anchor.fromLoadKg === null ? 0 : anchor.toLoadKg - anchor.fromLoadKg,
    suggestEarlyDeload: false,
    stalledLoadBySetNumber: stalledLoads(latest),
    anchorLoadBySetNumber: bySetNumber,
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

/** Null-load anchors riding a NON-anchor verdict (stall/hold/fill): the
 *  loaded sets' verdict stands, but load-less sets with evidence still get
 *  their performed-load ghost — mixed evidence anchors only the sets that
 *  testified. Spread into the adjustment; empty evidence adds nothing. */
function anchorRider(
  nullAnchors: Record<number, number>,
): Pick<AutoregAdjustment, 'anchorLoadBySetNumber'> | Record<string, never> {
  return Object.keys(nullAnchors).length > 0 ? { anchorLoadBySetNumber: nullAnchors } : {}
}

/**
 * The Layer 1 verdict for one exercise from its prior sessions. HARD
 * PRECONDITION: `sessions` is newest-first (callers order by startedAt desc,
 * id desc); a mis-ordered array would count the wrong streak. Only the first
 * `AUTOREG_SESSION_WINDOW` sessions are consulted (extras ignored). Verdict
 * order: OUTPERFORM (every scorable set ≥ prescribed × 1.05 at/above the
 * floor → anchor at the performed loads; mutually exclusive with a stall by
 * construction, but the precedence is stated, not assumed) → stall rules
 * (one or two consecutive stalls repeat the load; three back off ~10% and
 * suggest pulling the deload forward). Null-load sets with completed working
 * loads anchor regardless of the loaded verdict. Null = no adjustment
 * (schemes proceed untouched).
 */
export function autoregulate(
  incrementKg: number,
  sessions: readonly AutoregSession[],
): AutoregAdjustment | null {
  const window = sessions.slice(0, AUTOREG_SESSION_WINDOW)
  const latest = window[0]
  if (!latest) return null
  const nullAnchors = nullLoadAnchors(latest)
  const pairs = scorablePairs(latest)
  const outperform = outperformAnchors(pairs)
  if (outperform) return anchorVerdict(latest, outperform, nullAnchors, pairs.length)
  const latestStall = sessionStall(latest)
  if (!latestStall) return anchorVerdict(latest, null, nullAnchors, pairs.length)

  let consecutive = 1
  for (const session of window.slice(1)) {
    if (sessionStall(session) === null) break
    consecutive += 1
  }

  const shared = {
    stalledLoadBySetNumber: stalledLoads(latest),
    ...anchorRider(nullAnchors),
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
 * Total at-load working reps of two adjacent sessions over their SHARED
 * frame: pairs matched by setNumber, both scorable in their own session.
 * Null (not comparable — a rep-gain verdict would be noise, so the stall
 * streak resets) when no setNumber is scorable in both, or when ANY matched
 * pair's prescribed loads differ beyond epsilon: "failing to add reps" is
 * only meaningful AT THE SAME PRESCRIBED LOAD.
 */
function comparableTotals(
  current: AutoregSession,
  previous: AutoregSession,
): { totalReps: number; prevTotalReps: number } | null {
  const prevByNumber = new Map(scorablePairs(previous).map((p) => [p.setNumber, p]))
  let matched = 0
  let totalReps = 0
  let prevTotalReps = 0
  for (const pair of scorablePairs(current)) {
    const prev = prevByNumber.get(pair.setNumber)
    if (!prev) continue
    if (Math.abs(pair.loadKg - prev.loadKg) > LOAD_EPSILON_KG) return null
    matched += 1
    totalReps += pair.reps
    prevTotalReps += prev.reps
  }
  return matched === 0 ? null : { totalReps, prevTotalReps }
}

/**
 * The RANGE-mode (double progression) verdict for one exercise. Same HARD
 * PRECONDITION as `autoregulate`: `sessions` newest-first; only the first
 * `AUTOREG_RANGE_SESSION_WINDOW` are consulted.
 *
 * `rangeTopBySetNumber` is the CURRENT plan's range top per derived
 * setNumber — deliberately a plan PARAMETER, not a snapshotted fact: the top
 * defines the goal the lifter is climbing toward (like `stepKg`, which v1
 * already reads live), while the evidence scored against it (prescribed
 * loads, logged reps) stays snapshot-only. See the snapshot note in
 * db/programs.ts.
 *
 * Verdict order:
 * 1. FILL — every scorable working set of the latest session hit its range
 *    top at the prescribed load → step: +stepKg onto each prescribed-at-fill
 *    load, rep target back to repMin (the range floor is already the derived
 *    prescription's repMin — nothing to adjust there). When the fill was also
 *    an OUTPERFORM (every set ≥ prescribed × 1.05, floor met), the step
 *    COMPOSES with the anchor: the +stepKg lands on each set's PERFORMED
 *    load, not the out-run plan's (`applyAutoregToSets` reads the anchors).
 * 2. OUTPERFORM without a fill → anchor at the performed loads and keep
 *    climbing reps there (reps must be within the range — at/above repMin —
 *    for a set to testify).
 * 3. STALL ×3 — three consecutive session pairs with no total-rep gain at
 *    the same prescribed load → the v1 back-off (+ early-deload suggestion).
 * 4. Otherwise HOLD — the range model's default: add reps at the same load,
 *    so the prescription is capped at the latest prescribed loads (this is
 *    what stops a `linear` scheme's weekly increment mid-range).
 * Null-load sets with completed working loads anchor regardless of the
 * loaded verdict. Null when nothing is scorable and nothing anchors —
 * silence over corruption, as ever.
 */
export function autoregulateRange(
  stepKg: number,
  sessions: readonly AutoregSession[],
  rangeTopBySetNumber: Readonly<Record<number, number>>,
): AutoregAdjustment | null {
  const window = sessions.slice(0, AUTOREG_RANGE_SESSION_WINDOW)
  const latest = window[0]
  if (!latest) return null
  const nullAnchors = nullLoadAnchors(latest)
  const pairs = scorablePairs(latest)
  if (pairs.length === 0) return anchorVerdict(latest, null, nullAnchors, 0)

  const heaviest = pairs.reduce((a, b) => (b.loadKg > a.loadKg ? b : a))
  const knownTops = pairs.filter((p) => rangeTopBySetNumber[p.setNumber] !== undefined)
  const evidence = {
    missedSets: knownTops.filter((p) => p.reps < rangeTopBySetNumber[p.setNumber]).length,
    scorableSets: pairs.length,
    repFloor: rangeTopBySetNumber[heaviest.setNumber] ?? 0,
    loadKg: heaviest.loadKg,
  }

  // A fill must be CONFIRMABLE on every scorable set: a set whose number has
  // no top in today's plan (renumbered/resized template) can't testify to one.
  const filled =
    knownTops.length === pairs.length &&
    pairs.every((p) => p.reps >= rangeTopBySetNumber[p.setNumber])

  let stalls = 0
  for (let i = 0; i + 1 < window.length; i++) {
    const totals = comparableTotals(window[i], window[i + 1])
    if (totals === null || totals.totalReps > totals.prevTotalReps) break
    stalls += 1
  }

  const latestTotals = comparableTotals(latest, window[1] ?? { prescribed: [], actual: [] })
  const range = {
    totalReps: latestTotals?.totalReps ?? pairs.reduce((sum, p) => sum + p.reps, 0),
    prevTotalReps: latestTotals?.prevTotalReps ?? null,
    stalls,
  }
  const outperform = outperformAnchors(pairs)
  const shared = {
    stalledLoadBySetNumber: stalledLoads(latest),
    ...anchorRider(nullAnchors),
    evidence,
    range,
  }
  if (filled) {
    return {
      action: 'step',
      deltaKg: stepKg,
      suggestEarlyDeload: false,
      ...shared,
      // An outperformed fill steps FROM the performed loads: the anchors ride
      // the step (composition, not competition) and the reason line names the
      // performed load as the fill load.
      ...(outperform
        ? {
            anchorLoadBySetNumber: { ...nullAnchors, ...outperform.bySetNumber },
            anchor: { fromLoadKg: outperform.fromLoadKg, toLoadKg: outperform.toLoadKg },
          }
        : {}),
    }
  }
  if (outperform) return anchorVerdict(latest, outperform, nullAnchors, pairs.length, range)
  if (stalls >= STALLS_BEFORE_DECREMENT) {
    return {
      action: 'decrement',
      deltaKg: -backoffKg(evidence.loadKg, stepKg),
      suggestEarlyDeload: true,
      ...shared,
    }
  }
  return { action: 'repeat', deltaKg: 0, suggestEarlyDeload: false, ...shared }
}

/**
 * The ANCHOR-only rule set for schemes whose prescriptions can carry no load
 * (rpe-target before an e1RM exists, null-base weekly-volume /
 * rep-progression): the latest session's null-load working sets with
 * completed loads anchor at the performed load — the weight ghost those
 * exercises never had. LOADED sets are deliberately left to their scheme
 * (rpe-target self-corrects through the e1RM; stall rules for the rest are
 * out of scope). Same newest-first precondition as the other entry points.
 */
export function autoregulateAnchor(sessions: readonly AutoregSession[]): AutoregAdjustment | null {
  const latest = sessions[0]
  if (!latest) return null
  return anchorVerdict(latest, null, nullLoadAnchors(latest), 0)
}

/**
 * Applies a Layer 1 adjustment to a week's scheme-derived sets, BEFORE
 * overrides (override > autoreg — the caller merges overrides on top and they
 * replace both the load and the stamp). Each non-warmup scheme set is capped
 * against ITS OWN prescribed-at-stall load (matched by setNumber) — never one
 * global cap, so a set that passed at 100 kg is not slashed because a 90 kg
 * volume set failed. On decrement every cap scales by the evidence set's
 * back-off fraction. Sets with no stalled-session counterpart, warmups, and
 * non-scheme passthroughs are untouched. On repeat/decrement loads are never
 * raised (a scheme already below its cap keeps its own load); a range-mode
 * STEP is the one deliberate exception — the prescription becomes exactly
 * prescribed-at-fill + stepKg per set (a `double-progression` scheme still
 * holding its base is RAISED to the earned next load; a `linear` scheme that
 * ran ahead is pulled back to one honest step). Anchored sets (see
 * `anchorLoadBySetNumber`) are prescribed exactly their performed load — the
 * one path that may write a load onto a load-less scheme set — with a fill's
 * step composing on top for outperformed sets. Adjusted sets keep their
 * pre-autoreg value in `schemeLoadKg` (null for load-less sets) so surfaces
 * can offer "use plan as written". Scoring (the verdict) remains working-sets-only — backoff/amrap
 * sets are only FROZEN here (or stepped uniformly, mirroring how a linear
 * increment lands on every non-warmup set) so volume work can't climb past a
 * frozen top set.
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
    if (set.setType === 'warmup' || set.derivedFrom !== 'scheme') return set
    const anchorKg = adjustment.anchorLoadBySetNumber?.[set.setNumber]
    if (anchorKg !== undefined) {
      // Anchored: the performed load IS the prescription — exactly, up or
      // down — and the ONE path allowed to stamp a load onto a load-less
      // scheme set. A `step` composes on top when the set also has a
      // prescribed-at-fill counterpart (outperformed fill): the earned
      // increment lands on the performed load, not the out-run plan's.
      const stepsFromAnchor =
        adjustment.action === 'step' &&
        adjustment.stalledLoadBySetNumber[set.setNumber] !== undefined
      return {
        ...set,
        loadKg: stepsFromAnchor ? anchorKg + adjustment.deltaKg : anchorKg,
        derivedFrom: 'autoreg' as const,
        schemeLoadKg: set.loadKg,
      }
    }
    // An anchor verdict adjusts ONLY its anchored sets: unanchored
    // counterparts (skipped, incomplete, attempted-at-plan sets on a loaded
    // day) carry no evidence and stay exactly as the scheme derived them.
    if (adjustment.action === 'anchor') return set
    if (set.loadKg === null) return set
    const stalledLoadKg = adjustment.stalledLoadBySetNumber[set.setNumber]
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
 * The lifter-facing reason line — every adjustment ships one (the PRD's
 * transparency contract). Display unit applied here, not in the engine.
 *   Fixed:  "Missed 8 reps on 2 of 3 sets at 100 kg — repeating the load"
 *           "Third straight stall at 100 kg — backing off 10 kg (~10%)"
 *   Range:  "Range filled at 100 kg last session — stepping to 102.5 kg"
 *           "Range not filled at 100 kg — adding reps before the load steps"
 *           "No new reps at 100 kg (24 vs 24) — holding the load"
 *           "No new reps at 100 kg for 3 straight sessions — backing off ..."
 *   Anchor: "Did 120 kg vs 80 kg planned — anchoring at 120 kg"
 *           "Last session: 120 kg — anchoring"
 * An outperformed fill's step line speaks from the PERFORMED load (the
 * anchor), matching where `applyAutoregToSets` actually lands the step.
 */
export function autoregReason(adjustment: AutoregAdjustment, unit: WeightUnit): string {
  const load = `${kgToDisplay(adjustment.evidence.loadKg, unit)} ${unit}`
  if (adjustment.action === 'anchor' && adjustment.anchor) {
    const to = `${kgToDisplay(adjustment.anchor.toLoadKg, unit)} ${unit}`
    if (adjustment.anchor.fromLoadKg === null) return `Last session: ${to} — anchoring`
    const from = `${kgToDisplay(adjustment.anchor.fromLoadKg, unit)} ${unit}`
    return `Did ${to} vs ${from} planned — anchoring at ${to}`
  }
  if (adjustment.action === 'step') {
    const fillKg = adjustment.anchor?.toLoadKg ?? adjustment.evidence.loadKg
    const fill = `${kgToDisplay(fillKg, unit)} ${unit}`
    const next = `${kgToDisplay(fillKg + adjustment.deltaKg, unit)} ${unit}`
    return `Range filled at ${fill} last session — stepping to ${next}`
  }
  if (adjustment.range) {
    const { totalReps, prevTotalReps, stalls } = adjustment.range
    if (adjustment.action === 'decrement') {
      const backoff = `${kgToDisplay(-adjustment.deltaKg, unit)} ${unit}`
      return `No new reps at ${load} for ${stalls} straight sessions — backing off ${backoff} (~10%)`
    }
    return stalls > 0 && prevTotalReps !== null
      ? `No new reps at ${load} (${totalReps} vs ${prevTotalReps}) — holding the load`
      : `Range not filled at ${load} — adding reps before the load steps`
  }
  if (adjustment.action === 'decrement') {
    const backoff = `${kgToDisplay(-adjustment.deltaKg, unit)} ${unit}`
    return `Third straight stall at ${load} — backing off ${backoff} (~10%)`
  }
  const { missedSets, scorableSets, repFloor } = adjustment.evidence
  return `Missed ${repFloor} reps on ${missedSets} of ${scorableSets} sets at ${load} — repeating the load`
}
