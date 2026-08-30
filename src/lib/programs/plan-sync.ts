import {
  anchorLoadFor,
  sessionAnchorLoads,
  type AutoregAnchor,
  type AutoregSession,
} from './autoregulate'
import { kgToDisplay, type WeightUnit } from '../units'

/**
 * Plan-sync detection: after a COMPLETED program-provenance workout, which of
 * the plan's CURRENT suggested loads (program_sets.suggested_load_kg) did the
 * lifter outperform enough that the plan itself should follow? The verdict is
 * the engine's, not a re-implementation: `sessionAnchorLoads` (autoregulate.ts)
 * scores the performed sets against their prescribed-at-instantiation
 * SNAPSHOTS under the same ≥5% margin, rep-floor gate, epsilon, and
 * all-or-nothing discipline the derive-time anchor rule uses — the sync card
 * and the engine can never disagree about what counts as outperformed.
 *
 * EVIDENCE IS LOAD-KEYED (C2): the workout's session is scored against its
 * OWN snapshot columns (internally consistent, setNumber pairing allowed),
 * and the resulting anchor buckets are applied to plan sets by load — never
 * by setNumber, which a plan edit renumbers. A plan set at load L adopts the
 * bucket at/below L (ε-tolerant, `anchorLoadFor`); load-less plan sets adopt
 * the null bucket.
 *
 * UP-ANCHORS NEED CONFIRMATION (M2): a change that RAISES an existing plan
 * load is only offered when the PREVIOUS completed session of the day also
 * outperformed its own snapshots — two consecutive qualifying sessions, the
 * same rule the derive-time anchor uses. First anchors onto load-less plan
 * sets stay single-session (there is no plan load to chase).
 *
 * Interplay with the autoreg anchor rule: the anchor already fixes the NEXT
 * session's derived prescription (from immutable per-set snapshots); syncing
 * makes the PLAN durable — program stats, week derives, and the coach all see
 * the real load, after which performed == prescribed and the anchor rule
 * stops firing for that exercise. The two compose; neither depends on the
 * other, and both are user-visible (the sync is audited, never silent).
 *
 * Evidence rules, mirroring the engine's:
 * - skipped exercises and non-`weight_reps` slots never contribute
 *   (`sets.weight` is a total load only for that logging type);
 * - warm-ups (and backoff/amrap sets) never contribute — working sets only;
 * - INTENSITY-TECHNIQUE rows never contribute, top set included — the same
 *   exclusion db/autoreg-history.ts applies for the same reason (see
 *   `withoutTechniqueRows` below): both feed the same scorer, so they must
 *   score the same population;
 * - plan sets with NO suggested load anchor at the null bucket (the
 *   rpe-target case: syncing writes them a first real anchor);
 * - values already equal propose nothing, so a re-run after syncing is empty.
 */

export interface PlanSyncWorkoutSet {
  setNumber: number
  reps: number | null
  /** Stored kg — a total load only when the exercise is `weight_reps`. */
  weight: number | null
  completed: boolean
  setType: string
  /** Prescribed-at-instantiation snapshot — the facts the performance is
   *  scored against (never today's editable plan). */
  prescribedLoadKg: number | null
  prescribedRepMin: number | null
  /**
   * Non-null when this row is one stage of an intensity-technique group
   * (`sets.technique_kind`). Such rows are dropped before scoring.
   *
   * REQUIRED, not optional, deliberately: `withoutTechniqueRows` treats
   * "absent" and "null" alike, so an optional field would let a future caller
   * — a narrower `columns:` projection added for performance, another
   * get-workout adapter — silently reintroduce the bug this exclusion fixes,
   * with no compile error anywhere. Making it required means such a caller
   * fails to build instead.
   */
  techniqueKind: string | null
}

export interface PlanSyncWorkoutExercise {
  wgerExerciseId: number
  source: string
  loggingType: string
  skipped: boolean
  sets: readonly PlanSyncWorkoutSet[]
}

export interface PlanSyncPlanSet {
  setNumber: number
  setType: string
  metricMode: string
  repMin: number | null
  suggestedLoadKg: number | null
}

export interface PlanSyncPlanExercise {
  /** 0-based position within the day — the narrow patch path's address. */
  position: number
  wgerExerciseId: number
  source: string
  name: string
  sets: readonly PlanSyncPlanSet[]
}

export interface PlanSyncSetChange {
  setNumber: number
  /** The plan's current suggested load (null = no load prescribed yet). */
  currentLoadKg: number | null
  /** The performed load the plan would adopt. */
  proposedLoadKg: number
}

export interface PlanSyncCandidate {
  exercisePosition: number
  name: string
  /** Ascending by setNumber; only sets whose value would actually change. */
  changes: PlanSyncSetChange[]
}

/** First occurrence per composite exercise identity — a day (or workout) that
 *  repeats an exercise contributes/receives its FIRST slot only, mirroring the
 *  engine's and the logger's first-slot-wins keying (and keeping one session's
 *  evidence from patching two plan slots). */
function firstByIdentity<T extends { source: string; wgerExerciseId: number }>(
  rows: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>()
  for (const row of rows) {
    const key = `${row.source}:${row.wgerExerciseId}`
    if (!map.has(key)) map.set(key, row)
  }
  return map
}

/**
 * The exercise's sets minus every row belonging to an intensity-technique
 * group — the top set included, exactly the predicate db/autoreg-history.ts
 * applies (`isNull(sets.techniqueKind)`) before handing rows to this same
 * scorer. These sets are taken to failure BY DESIGN, so a per-set rep floor
 * is the wrong yardstick for them, and the numbers they produce are not
 * evidence about what the PLAN's loads should be:
 *
 *  - a stage's snapshot load is a fraction of the top set's, so it opens an
 *    anchor bucket at a load the plan may also use for a backoff set — which
 *    would then adopt a drop's performance;
 *  - an UNAUTHORED stage carries no snapshot load at all (a null there means
 *    "the lifter types what they dropped to", never a prescription), so it
 *    landed in `firstAnchorKg`'s null bucket and handed a load-less plan set
 *    its first real anchor off a drop weight — the phantom prescription the
 *    null stage load exists to prevent.
 *
 * Ordinary sets in the same exercise still testify, and the group's own
 * signal (total reps across the stages) is the seam total-reps scoring lands
 * on, in both consumers at once.
 */
function withoutTechniqueRows(
  sets: readonly PlanSyncWorkoutSet[],
): readonly PlanSyncWorkoutSet[] {
  return sets.filter((s) => s.techniqueKind == null)
}

/** One workout exercise as an engine session, scored against its OWN
 *  prescribed-at-instantiation snapshots — both sides come from the same
 *  logged rows, so setNumber pairing is internally consistent. Ordering is
 *  irrelevant for single-session scoring (startedAtMs 0). */
function snapshotSession(exercise: PlanSyncWorkoutExercise): AutoregSession {
  const sets = withoutTechniqueRows(exercise.sets)
  return {
    startedAtMs: 0,
    prescribed: sets.map((s) => ({
      setNumber: s.setNumber,
      repMin: s.prescribedRepMin,
      loadKg: s.prescribedLoadKg,
      setType: s.setType,
    })),
    actual: sets.map((s) => ({
      setNumber: s.setNumber,
      reps: s.reps,
      weightKg: s.weight,
      completed: s.completed,
      setType: s.setType,
    })),
  }
}

/** The null-bucket anchor for plan rows that prescribe NOTHING (no load, no
 *  floor — rpe-only prescriptions): the engine's null-load rule demands a
 *  snapshot floor because in a snapshot null+null means "no snapshot at
 *  all", but a load-less PLAN row is a real row with no such ambiguity, so
 *  its first anchor may come from any completed working load whose snapshot
 *  prescribed no load. Minimum performed — the engine's conservative
 *  null-bucket convention. */
function firstAnchorKg(exercise: PlanSyncWorkoutExercise): number | undefined {
  const loads = withoutTechniqueRows(exercise.sets)
    .filter(
      (s) =>
        s.completed &&
        s.setType === 'working' &&
        s.prescribedLoadKg === null &&
        s.reps !== null &&
        s.weight !== null &&
        s.weight > 0,
    )
    .map((s) => s.weight as number)
  return loads.length > 0 ? Math.min(...loads) : undefined
}

/**
 * The confirmed-sync candidates for one completed workout against its program
 * day's CURRENT plan. Pure — callers supply the trees; ordering follows the
 * plan's exercise order. `previousWorkoutExercises` is the day's previous
 * completed session (M2): without it — or when it didn't also outperform its
 * own snapshots — up-anchor changes are withheld. Empty array = nothing to
 * offer (no card).
 */
export function detectPlanSyncCandidates(
  workoutExercises: readonly PlanSyncWorkoutExercise[],
  planExercises: readonly PlanSyncPlanExercise[],
  previousWorkoutExercises?: readonly PlanSyncWorkoutExercise[],
): PlanSyncCandidate[] {
  // Only performed weight_reps slots testify: a skipped exercise attempted
  // nothing, and non-weight_reps `weight` values aren't absolute loads.
  const performed = (rows: readonly PlanSyncWorkoutExercise[]) =>
    firstByIdentity(rows.filter((e) => !e.skipped && e.loggingType === 'weight_reps'))
  const workoutByIdentity = performed(workoutExercises)
  const previousByIdentity = performed(previousWorkoutExercises ?? [])

  const candidates: PlanSyncCandidate[] = []
  for (const plan of firstByIdentity(planExercises).values()) {
    const identity = `${plan.source}:${plan.wgerExerciseId}`
    const done = workoutByIdentity.get(identity)
    if (!done) continue
    const anchors: AutoregAnchor[] = sessionAnchorLoads(snapshotSession(done))
    if (!anchors.some((a) => a.prescribedLoadKg === null)) {
      const first = firstAnchorKg(done)
      if (first !== undefined) anchors.push({ prescribedLoadKg: null, anchorKg: first })
    }
    if (anchors.length === 0) continue

    // M2: raising an existing plan load needs the previous session of the
    // day to have outperformed its own snapshots too — one good day is not a
    // trend the plan should chase.
    const previous = previousByIdentity.get(identity)
    const upAnchorsConfirmed =
      previous !== undefined &&
      sessionAnchorLoads(snapshotSession(previous)).some((a) => a.prescribedLoadKg !== null)

    // Loads sync onto reps_weight plan sets only — a duration set has no load
    // prescription to update. Application is load-keyed (C2): each plan set
    // adopts the anchor bucket its OWN load belongs to.
    const changes: PlanSyncSetChange[] = []
    for (const planSet of plan.sets) {
      if (planSet.metricMode !== 'reps_weight') continue
      const proposed = anchorLoadFor(anchors, planSet.suggestedLoadKg)
      if (proposed === undefined) continue // no evidence → set unchanged
      if (planSet.suggestedLoadKg === proposed) continue // already synced → no-op
      if (planSet.suggestedLoadKg !== null && !upAnchorsConfirmed) continue // M2
      changes.push({
        setNumber: planSet.setNumber,
        currentLoadKg: planSet.suggestedLoadKg,
        proposedLoadKg: proposed,
      })
    }
    if (changes.length > 0) {
      changes.sort((a, b) => a.setNumber - b.setNumber)
      candidates.push({ exercisePosition: plan.position, name: plan.name, changes })
    }
  }
  return candidates
}

/**
 * The change-log line for one synced exercise, in the user's display unit —
 * e.g. "Leg Extension: 80 → 120 lb (synced to performance)". Speaks from the
 * heaviest changed set (by current plan load, then proposed — the engine's
 * heaviest-set evidence convention); a first anchor (no current load) names
 * only the adopted load.
 */
export function planSyncEventSummary(candidate: PlanSyncCandidate, unit: WeightUnit): string {
  const top = candidate.changes.reduce((a, b) => {
    const currentA = a.currentLoadKg ?? Number.NEGATIVE_INFINITY
    const currentB = b.currentLoadKg ?? Number.NEGATIVE_INFINITY
    if (currentB !== currentA) return currentB > currentA ? b : a
    return b.proposedLoadKg > a.proposedLoadKg ? b : a
  })
  const to = `${kgToDisplay(top.proposedLoadKg, unit)} ${unit}`
  if (top.currentLoadKg === null) return `${candidate.name}: ${to} (synced to performance)`
  return `${candidate.name}: ${kgToDisplay(top.currentLoadKg, unit)} → ${to} (synced to performance)`
}
