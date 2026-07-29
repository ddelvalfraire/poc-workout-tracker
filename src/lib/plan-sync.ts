import { sessionAnchorLoads, type AutoregSession } from './autoregulate'
import { kgToDisplay, type WeightUnit } from './units'

/**
 * Plan-sync detection: after a COMPLETED program-provenance workout, which of
 * the plan's CURRENT suggested loads (program_sets.suggested_load_kg) did the
 * lifter outperform enough that the plan itself should follow? The verdict is
 * the engine's, not a re-implementation: `sessionAnchorLoads` (autoregulate.ts)
 * scores the performed sets against the plan loads under the same ≥5% margin,
 * rep-floor gate, epsilon, and all-or-nothing discipline the derive-time
 * anchor rule uses — the sync card and the engine can never disagree about
 * what counts as outperformed.
 *
 * Interplay with the autoreg anchor rule: the anchor already fixes the NEXT
 * session's derived prescription (from immutable per-set snapshots); syncing
 * makes the PLAN durable — program stats, week derives, and the coach all see
 * the real load, after which performed == prescribed and the anchor rule
 * stops firing for that exercise. The two compose; neither depends on the
 * other, and both are user-visible (the sync is confirmed, never silent).
 *
 * Evidence rules, mirroring the engine's:
 * - skipped exercises and non-`weight_reps` slots never contribute
 *   (`sets.weight` is a total load only for that logging type);
 * - warm-ups (and backoff/amrap sets) never contribute — working sets only;
 * - sets pair by setNumber; sets without evidence are left unchanged;
 * - plan sets with NO suggested load anchor at any completed working load
 *   (the rpe-target case: syncing writes them a first real anchor);
 * - values already equal propose nothing, so a re-run after syncing is empty.
 */

export interface PlanSyncWorkoutSet {
  setNumber: number
  reps: number | null
  /** Stored kg — a total load only when the exercise is `weight_reps`. */
  weight: number | null
  completed: boolean
  setType: string
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
 * The confirmed-sync candidates for one completed workout against its program
 * day's CURRENT plan. Pure — callers supply both trees; ordering follows the
 * plan's exercise order. Empty array = nothing to offer (no card).
 */
export function detectPlanSyncCandidates(
  workoutExercises: readonly PlanSyncWorkoutExercise[],
  planExercises: readonly PlanSyncPlanExercise[],
): PlanSyncCandidate[] {
  const workoutByIdentity = firstByIdentity(
    // Only performed weight_reps slots testify: a skipped exercise attempted
    // nothing, and non-weight_reps `weight` values aren't absolute loads.
    workoutExercises.filter((e) => !e.skipped && e.loggingType === 'weight_reps'),
  )
  const candidates: PlanSyncCandidate[] = []
  for (const plan of firstByIdentity(planExercises).values()) {
    const done = workoutByIdentity.get(`${plan.source}:${plan.wgerExerciseId}`)
    if (!done) continue
    // Loads sync onto reps_weight plan sets only — a duration set has no load
    // prescription to update.
    const planSets = plan.sets.filter((s) => s.metricMode === 'reps_weight')
    const session: AutoregSession = {
      prescribed: planSets.map((s) => ({
        setNumber: s.setNumber,
        repMin: s.repMin,
        loadKg: s.suggestedLoadKg,
        setType: s.setType,
      })),
      actual: done.sets.map((s) => ({
        setNumber: s.setNumber,
        reps: s.reps,
        weightKg: s.weight,
        completed: s.completed,
        setType: s.setType,
      })),
    }
    const anchors = sessionAnchorLoads(session)
    // The engine's null-load anchor demands a non-null repMin because in a
    // SNAPSHOT a null repMin beside a null load means "no snapshot at all".
    // A program set is a real plan row — no such ambiguity — so a load-less,
    // floor-less plan set (rpe-only prescriptions) still takes a first anchor
    // from a completed working load. Same evidence rules otherwise.
    const actualByNumber = new Map(done.sets.map((s) => [s.setNumber, s]))
    for (const planSet of planSets) {
      if (planSet.suggestedLoadKg !== null || planSet.repMin !== null) continue
      if (planSet.setType !== 'working' || anchors[planSet.setNumber] !== undefined) continue
      const actual = actualByNumber.get(planSet.setNumber)
      if (!actual?.completed || actual.setType !== 'working') continue
      if (actual.reps === null || actual.weight === null || actual.weight <= 0) continue
      anchors[planSet.setNumber] = actual.weight
    }

    const changes: PlanSyncSetChange[] = []
    for (const planSet of planSets) {
      const proposed = anchors[planSet.setNumber]
      if (proposed === undefined) continue // no evidence → set unchanged
      if (planSet.suggestedLoadKg === proposed) continue // already synced → no-op
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
