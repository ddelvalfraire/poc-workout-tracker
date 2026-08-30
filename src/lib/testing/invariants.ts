import {
  applyOverride,
  amrapCompletedWaves,
  deriveWeekSets,
  DELOAD_SET_FACTOR,
  type DerivedSet,
  type ExerciseHistoryInput,
  type ProgramSetRowLike,
  type SetOverrideLike,
} from '@/lib/programs/progression'
import {
  autoregReason,
  anchorLoadFor,
  sessionAnchorLoads,
  type AutoregAdjustment,
  type AutoregSession,
} from '@/lib/programs/autoregulate'
import type {
  PlanSyncCandidate,
  PlanSyncPlanExercise,
  PlanSyncWorkoutExercise,
} from '@/lib/programs/plan-sync'
import type { Progression } from '@/lib/programs/program-input'

/**
 * Layer 1 of the progression test harness (progression-test-harness.prd.md):
 * the invariant REGISTRY. Each export is a named predicate mechanizing one
 * docblock law (H/C/M codes from autoregulate.ts, the precedence law from
 * progression.ts, plan-sync's shared-evidence contract) verbatim. Layers 2+
 * cite these by name — invariants are defined ONCE, here.
 *
 * Extensibility rules honored (PRD, locked):
 * - imports ONLY the public engine surface, never private helpers;
 * - window/threshold constants come from the engine, never hardcoded;
 * - predicates are pure booleans over engine inputs/outputs so fast-check's
 *   shrinker reports minimal counterexamples.
 *
 * Where a docblock's private quantity (e.g. the epsilon-bucketed top load)
 * cannot be read from outside, the calling property CONSTRUCTS inputs whose
 * classification is unambiguous at any epsilon (≥ 1 kg separation), so the
 * predicate never has to re-derive private constants.
 */

/** Tolerance for float comparisons in differential checks — far below any
 *  load the engine distinguishes, far above IEEE noise. */
export const FLOAT_TOLERANCE = 1e-9

const loadsEqual = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a === b : Math.abs(a - b) <= FLOAT_TOLERANCE

/**
 * PRECEDENCE (progression.ts module docblock): "per-week OVERRIDE > DELOAD
 * modifier > progression SCHEME > template row". Mechanized at the top of the
 * chain: `applyOverride` must land every NON-NULL override field on the set
 * (over whatever scheme/deload derived), leave null fields at the derived
 * value, stamp `derivedFrom: 'override'` iff anything applied, and leave the
 * set untouched for a missing/all-null override.
 */
export function overridePrecedenceHolds(
  derived: DerivedSet,
  override: SetOverrideLike | null,
): boolean {
  const merged = applyOverride(derived, override)
  if (override === null) return merged === derived
  const anyApplied = (Object.values(override) as (unknown | null)[]).some((v) => v !== null)
  if (!anyApplied) return merged === derived
  if (merged.derivedFrom !== 'override') return false
  const wins = <K extends keyof DerivedSet>(key: K, value: DerivedSet[K] | null): boolean =>
    value !== null ? merged[key] === value : merged[key] === derived[key]
  return (
    wins('repMin', override.repMin) &&
    wins('repMax', override.repMax) &&
    wins('rir', override.rir) &&
    wins('rpe', override.rpe) &&
    wins('loadKg', override.suggestedLoadKg) &&
    wins('tempo', override.tempo) &&
    wins('durationSec', override.durationSec) &&
    wins('distanceM', override.distanceM) &&
    wins('restSec', override.restSec) &&
    wins('technique', override.technique)
  )
}

/**
 * LOAD SANITY (progression.ts `clampLoad`: "Never prescribe a negative load;
 * keep null as 'no prescription'"; autoregulate.ts `applyAutoregToSets`:
 * Math.max(0, …) on every capped target). Every prescription — post-scheme,
 * post-deload, or post-autoreg — is null or a finite number ≥ 0.
 */
export function loadsFiniteNonNegative(sets: readonly DerivedSet[]): boolean {
  return sets.every((s) => s.loadKg === null || (Number.isFinite(s.loadKg) && s.loadKg >= 0))
}

/**
 * DELOAD SHAPE (deriveWeekSets docblock: "the deload week then scales … the
 * working-set count by DELOAD_SET_FACTOR (ceil, min 1)"; progressed sets are
 * stamped `derivedFrom: 'deload'`). Working count on the deload week is
 * exactly max(1, ceil(templateWorking × DELOAD_SET_FACTOR)) and every
 * non-warmup set carries the 'deload' stamp.
 */
export function deloadShapeHolds(
  templateSets: readonly ProgramSetRowLike[],
  deloadDerived: readonly DerivedSet[],
): boolean {
  const templateWorking = templateSets.filter((s) => s.setType === 'working').length
  const expected =
    templateWorking === 0 ? 0 : Math.max(1, Math.ceil(templateWorking * DELOAD_SET_FACTOR))
  const derivedWorking = deloadDerived.filter((s) => s.setType === 'working').length
  if (templateWorking > 0 && derivedWorking !== expected) return false
  return deloadDerived.every((s) => s.setType === 'warmup' || s.derivedFrom === 'deload')
}

/**
 * H2 — "any prescribed-load change, including an applied back-off, resets the
 * streak" (autoregulate.ts FIXED-mode scope docblock; also the `autoregulate`
 * docblock: "three AT THE SAME prescribed top load"). Callers construct
 * stall-only windows whose latest top load differs from the older stalls by
 * ≥ 1 kg (unambiguous at any epsilon): the verdict must then never escalate
 * to a decrement.
 */
export function h2StreakResetsOnLoadChange(adjustment: AutoregAdjustment | null): boolean {
  return adjustment === null || adjustment.action !== 'decrement'
}

/**
 * H6 — "the ordering contract: every entry point sorts descending on
 * `startedAtMs` instead of trusting array order" (AutoregSession docblock).
 * Any permutation of the same sessions must produce a deep-equal verdict.
 * Callers guarantee distinct `startedAtMs` so the sort is total.
 */
export function h6OrderInsensitive(
  compute: (sessions: readonly AutoregSession[]) => AutoregAdjustment | null,
  sessions: readonly AutoregSession[],
  permuted: readonly AutoregSession[],
): boolean {
  return JSON.stringify(compute(sessions)) === JSON.stringify(compute(permuted))
}

/**
 * M3 — "no verdict of any kind issues without an evidence quorum of at least
 * half the snapshot's working sets" (autoregulate.ts module docblock;
 * `meetsQuorum`: "at least half (ceil)"). Callers construct all-loaded
 * 'all-sets' sessions with exactly `evidenceCount` scorable working pairs out
 * of `snapshotWorkingSets` prescribed: under quorum the verdict must be null.
 */
export function m3QuorumGatesVerdict(
  adjustment: AutoregAdjustment | null,
  evidenceCount: number,
  snapshotWorkingSets: number,
): boolean {
  if (evidenceCount * 2 >= snapshotWorkingSets) return true // quorum met — no claim here
  return adjustment === null
}

/**
 * M2 — "Up-anchors (outperform) require TWO consecutive qualifying sessions"
 * (autoregulate.ts module docblock; `confirmedOutperform`). Whatever the
 * verdict, it is never an anchor that RAISES a prescribed load unless two
 * consecutive outperform sessions exist — the calling property provides only
 * one, so any up-anchor is a violation.
 */
export function m2NoUpAnchorFromSingleSession(adjustment: AutoregAdjustment | null): boolean {
  if (adjustment === null || adjustment.action !== 'anchor' || !adjustment.anchor) return true
  const { fromLoadKg, toLoadKg } = adjustment.anchor
  return fromLoadKg === null || toLoadKg <= fromLoadKg + FLOAT_TOLERANCE
}

/**
 * H3 (verification re-break) — "a mixed-top bucket can never step"
 * (`classifyRange`: "Heterogeneous tops within one bucket … a fill is
 * unconfirmable here"). Callers build `rangeRows` sharing one load bucket
 * with differing non-null tops: the verdict must never be a 'step'.
 */
export function h3MixedTopBucketNeverSteps(adjustment: AutoregAdjustment | null): boolean {
  return adjustment === null || adjustment.action !== 'step'
}

/**
 * C2 — "EVIDENCE IS LOAD-KEYED, NEVER POSITIONAL … program edits renumber
 * sets, so a setNumber means nothing across sessions" (autoregulate.ts module
 * docblock; `applyAutoregToSets` caps "against the largest evidence load X
 * with L ≥ X − ε"). Renumbering today's derived sets must not change any
 * applied load: the two applications must agree positionally on loads,
 * stamps, and scheme-load snapshots.
 */
export function c2CapsAreLoadKeyedNotPositional(
  applied: readonly DerivedSet[],
  appliedRenumbered: readonly DerivedSet[],
): boolean {
  if (applied.length !== appliedRenumbered.length) return false
  return applied.every(
    (s, i) =>
      loadsEqual(s.loadKg, appliedRenumbered[i].loadKg) &&
      s.derivedFrom === appliedRenumbered[i].derivedFrom &&
      loadsEqual(s.schemeLoadKg ?? null, appliedRenumbered[i].schemeLoadKg ?? null),
  )
}

/**
 * C2 (untouched bucket) — "a genuinely new lighter set (below every evidence
 * load) is untouched" (`applyAutoregToSets` docblock). For a repeat/decrement
 * verdict with no anchor buckets, any scheme set whose load sits ≥ 1 kg below
 * every stalled evidence load must come through identical.
 */
export function c2LighterSetBelowEvidenceUntouched(
  before: DerivedSet,
  after: DerivedSet,
  adjustment: AutoregAdjustment,
): boolean {
  if (adjustment.action !== 'repeat' && adjustment.action !== 'decrement') return true
  if (adjustment.anchorLoads && adjustment.anchorLoads.length > 0) return true
  if (before.loadKg === null) return true
  const minEvidence = Math.min(...adjustment.stalledLoads)
  if (adjustment.stalledLoads.length === 0 || before.loadKg < minEvidence - 1) {
    return loadsEqual(before.loadKg, after.loadKg) && before.derivedFrom === after.derivedFrom
  }
  return true
}

/**
 * TRANSPARENCY — "no adjustment without a reason" (autoregulate.ts module
 * docblock; `autoregReason`: "every adjustment ships one"). Every produced
 * verdict must render a non-empty reason line free of formatting corruption.
 */
export function reasonNonEmptyOnAdjustment(adjustment: AutoregAdjustment | null): boolean {
  if (adjustment === null) return true
  const reason = autoregReason(adjustment, 'kg')
  return reason.length > 0 && !reason.includes('NaN') && !reason.includes('undefined')
}

/**
 * WAVE ARITHMETIC (amrapCompletedWaves docblock: "the wave-boundary count
 * instantiation banks a TM bump against — and the same arithmetic
 * `amrapCycleTargets` cycles on, so the two can't drift"). The closed form
 * must equal the naive definition: count non-deload weeks strictly before
 * `week` (clamped into the mesocycle), floor-divide by the wave length.
 */
export function waveArithmeticNoDrift(
  week: number,
  mesocycleWeeks: number,
  deloadWeek: number | null,
  waveLength: number,
): boolean {
  const clampedWeek = Math.min(Math.max(1, week), Math.max(1, mesocycleWeeks))
  let steps = 0
  for (let w = 1; w <= Math.max(1, mesocycleWeeks); w++) {
    if (w !== deloadWeek && w < clampedWeek) steps++
  }
  const naive = waveLength < 1 ? 0 : Math.floor(steps / waveLength)
  return amrapCompletedWaves(week, mesocycleWeeks, deloadWeek, waveLength) === naive
}

/**
 * BANKED-WAVE EQUIVALENCE (program-input.ts `bankedWaves` docblock: banked
 * bumps are "already FOLDED INTO trainingMaxKg … the engine adds increments
 * only for completed waves BEYOND this count, so a persisted bump and the
 * derive-time wave math can never double-count"). For any week whose
 * completed-wave count ≥ the bank, deriving with {TM: t, bankedWaves: b}
 * must equal deriving with {TM: t − b·incrementKg, bankedWaves: 0}.
 */
export function bankedWaveEquivalenceHolds(args: {
  sets: ProgramSetRowLike[]
  progression: Extract<Progression, { scheme: 'amrap-cycle' }>
  week: number
  mesocycleWeeks: number
  deloadWeek: number | null
  history: ExerciseHistoryInput
}): boolean {
  const { progression } = args
  const banked = progression.bankedWaves ?? 0
  const completed = amrapCompletedWaves(
    args.week,
    args.mesocycleWeeks,
    args.deloadWeek,
    progression.wave.length,
  )
  if (completed < banked) return true // outside the equivalence's domain
  const derive = (p: Extract<Progression, { scheme: 'amrap-cycle' }>) =>
    deriveWeekSets({ ...args, progression: p })
  const withBank = derive(progression)
  const unbanked = derive({
    ...progression,
    trainingMaxKg: progression.trainingMaxKg - banked * progression.incrementKg,
    bankedWaves: 0,
  })
  return (
    withBank.length === unbanked.length &&
    withBank.every((s, i) => loadsEqual(s.loadKg, unbanked[i].loadKg))
  )
}

/**
 * SHARED-EVIDENCE CONTRACT (plan-sync.ts module docblock: "The verdict is the
 * engine's, not a re-implementation: `sessionAnchorLoads` … the sync card and
 * the engine can never disagree"; application is via `anchorLoadFor` — C2;
 * up-anchors on loaded plan sets need confirmation — M2). For workouts whose
 * snapshots all carry loads (so plan-sync's null-bucket extension is inert),
 * every proposed change must be EXACTLY what the engine's anchors dictate for
 * that plan load — present iff `anchorLoadFor` names a different load (gated
 * by confirmation for loaded sets), valued at the engine's anchor.
 */
export function planSyncAgreesWithEngine(
  workout: PlanSyncWorkoutExercise,
  plan: PlanSyncPlanExercise,
  upAnchorsConfirmed: boolean,
  candidate: PlanSyncCandidate | undefined,
): boolean {
  // The same session shape plan-sync builds: both sides from the logged rows,
  // and — like plan-sync's own `withoutTechniqueRows` — with every row of an
  // intensity-technique group dropped. This mirror has to apply the exclusion
  // too, or the invariant would assert agreement between a scorer that skips
  // those rows and a reference that does not, and fail on exactly the input
  // the exclusion exists for.
  const scorable = workout.sets.filter((s) => s.techniqueKind == null)
  const session: AutoregSession = {
    startedAtMs: 0,
    prescribed: scorable.map((s) => ({
      setNumber: s.setNumber,
      repMin: s.prescribedRepMin,
      loadKg: s.prescribedLoadKg,
      setType: s.setType,
    })),
    actual: scorable.map((s) => ({
      setNumber: s.setNumber,
      reps: s.reps,
      weightKg: s.weight,
      completed: s.completed,
      setType: s.setType,
    })),
  }
  const anchors = sessionAnchorLoads(session)
  const expected: { setNumber: number; proposedLoadKg: number }[] = []
  for (const planSet of plan.sets) {
    if (planSet.metricMode !== 'reps_weight') continue
    const proposed = anchorLoadFor(anchors, planSet.suggestedLoadKg)
    if (proposed === undefined) continue
    if (planSet.suggestedLoadKg === proposed) continue
    if (planSet.suggestedLoadKg !== null && !upAnchorsConfirmed) continue
    expected.push({ setNumber: planSet.setNumber, proposedLoadKg: proposed })
  }
  const actual = candidate?.changes ?? []
  return (
    actual.length === expected.length &&
    expected.every(
      (e, i) =>
        actual[i].setNumber === e.setNumber && loadsEqual(actual[i].proposedLoadKg, e.proposedLoadKg),
    )
  )
}
